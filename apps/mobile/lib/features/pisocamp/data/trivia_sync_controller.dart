import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:mobile/core/utils/retry_waiter.dart';
import 'package:mobile/features/pisocamp/data/trivia_repository.dart';
import 'package:mobile/features/pisocamp/data/trivia_response.dart';
import 'package:mobile/features/pisocamp/data/trivia_response_store.dart';

enum TriviaSyncTrigger {
  startup,
  reconnect,

  /// The one-off upload of a guest's backlog after they register.
  registration,

  answered,
}

enum TriviaSyncPhase { idle, syncing, retrying, stopped, disposed }

enum TriviaSyncOutcome {
  none,
  success,

  /// Nothing was attempted: no connection, or nobody to sync for.
  skipped,
  transientFailure,
  permanentFailure,

  /// The account may not sync. Everything stays on the device.
  rejected,
  cancelled,
}

@immutable
final class TriviaSyncState {
  const TriviaSyncState({
    this.phase = TriviaSyncPhase.idle,
    this.outcome = TriviaSyncOutcome.none,
    this.uploadedCount = 0,
    this.pendingCount = 0,
    this.attempt = 0,
    this.reasonCode,
  });

  final TriviaSyncPhase phase;
  final TriviaSyncOutcome outcome;

  /// How many responses the server acknowledged during this run.
  final int uploadedCount;

  /// How many are still waiting on the device.
  final int pendingCount;
  final int attempt;
  final String? reasonCode;
}

/// Who the device is syncing for, at the moment it is asked.
@immutable
final class TriviaSyncAccount {
  const TriviaSyncAccount({required this.accountId});

  /// The registered account's id. A guest has none, and a guest's answers do
  /// not leave the device.
  final String accountId;
}

/// Uploads recorded answers, and only ever deletes what was acknowledged.
///
/// The device is the source of truth until the server says otherwise: an
/// answer is recorded locally first, uploaded second, and marked synced third.
/// Any interruption leaves it pending, and re-sending it is safe because the
/// response id is the server's primary key.
final class TriviaSyncController implements TriviaResponseSink {
  TriviaSyncController({
    required TriviaResponseStore store,
    required TriviaUploadPort uploader,
    required bool Function() isOnline,
    required TriviaSyncAccount? Function() currentAccount,
    RetryWaiter? retryWaiter,
    Duration Function(Duration)? jitter,
    int maxAttempts = 4,
  }) : _store = store,
       _uploader = uploader,
       _isOnline = isOnline,
       _currentAccount = currentAccount,
       _retryWaiter = retryWaiter ?? TimerRetryWaiter(),
       _jitter = jitter ?? secureRetryJitter,
       _maxAttempts = maxAttempts;

  final TriviaResponseStore _store;
  final TriviaUploadPort _uploader;
  final bool Function() _isOnline;
  final TriviaSyncAccount? Function() _currentAccount;
  final RetryWaiter _retryWaiter;
  final Duration Function(Duration) _jitter;
  final int _maxAttempts;
  final ValueNotifier<TriviaSyncState> _state = ValueNotifier(
    const TriviaSyncState(),
  );

  /// A page size large enough to mean "everything", used only for counting.
  static const int _unlimited = 1 << 30;
  Future<void>? _active;
  var _disposed = false;

  /// Set when a sync is asked for while one is already running.
  ///
  /// Joining the run in flight is not enough on its own: that run may already
  /// have read its batch, or decided it was offline, before the request
  /// arrived. Without a second pass a reconnect that lands mid-run would be
  /// swallowed and the backlog would wait for the next trigger.
  var _rerunRequested = false;

  ValueListenable<TriviaSyncState> get state => _state;

  /// Records one answer, then offers to upload it.
  ///
  /// Recording never depends on the upload: a guest, a deactivated account and
  /// a device in a lift all keep their answer.
  @override
  Future<void> record(TriviaResponseRecord response) async {
    await _store.record(response);
    await sync(TriviaSyncTrigger.answered);
  }

  /// Runs a sync, joining one already in flight rather than starting a second.
  Future<void> sync(TriviaSyncTrigger trigger) {
    final active = _active;
    if (active != null) {
      _rerunRequested = true;
      if (trigger == TriviaSyncTrigger.reconnect) _retryWaiter.cancel();
      return active;
    }
    late final Future<void> run;
    run = _runUntilSettled(trigger).whenComplete(() {
      if (identical(_active, run)) _active = null;
    });
    _active = run;
    return run;
  }

  /// The guest-to-registered merge, which happens once.
  ///
  /// The responses are already on the device with their ids, so the merge is
  /// an upload rather than a rewrite. Recording which account claimed the
  /// backlog is what makes it once: a second account registered on the same
  /// device does not inherit somebody else's answers.
  Future<void> mergeIntoAccount(String accountId) async {
    final merged = await _store.readMergedAccountId();
    if (merged != null) return;
    await _store.recordMerged(accountId);
    await sync(TriviaSyncTrigger.registration);
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _retryWaiter.cancel();
    _state.value = const TriviaSyncState(
      phase: TriviaSyncPhase.disposed,
      outcome: TriviaSyncOutcome.cancelled,
      reasonCode: 'disposed',
    );
    _state.dispose();
  }

  /// Drains, then drains again for any request that arrived mid-run.
  Future<void> _runUntilSettled(TriviaSyncTrigger trigger) async {
    _rerunRequested = false;
    await _drain(trigger);
    while (_rerunRequested && !_disposed) {
      _rerunRequested = false;
      await _drain(trigger);
    }
  }

  Future<void> _drain(TriviaSyncTrigger trigger) async {
    var uploaded = 0;
    var attempt = 0;
    while (!_disposed) {
      final account = _currentAccount();
      if (account == null) {
        // A guest keeps everything. Nothing here is an error: this is the
        // ordinary state of the module before anyone registers.
        return await _publish(
          TriviaSyncPhase.idle,
          TriviaSyncOutcome.skipped,
          uploaded,
          attempt,
          'guest',
        );
      }
      if (!_isOnline()) {
        return await _publish(
          TriviaSyncPhase.stopped,
          TriviaSyncOutcome.skipped,
          uploaded,
          attempt,
          'offline',
        );
      }

      late List<TriviaResponseRecord> batch;
      try {
        batch = await _store.readPending();
      } on Object {
        return await _publish(
          TriviaSyncPhase.stopped,
          TriviaSyncOutcome.permanentFailure,
          uploaded,
          attempt,
          'storeUnreadable',
        );
      }
      if (_disposed) return;
      if (batch.isEmpty) {
        return await _publish(
          TriviaSyncPhase.idle,
          TriviaSyncOutcome.success,
          uploaded,
          attempt,
          null,
        );
      }

      await _publish(
        TriviaSyncPhase.syncing,
        TriviaSyncOutcome.none,
        uploaded,
        attempt,
        null,
      );
      try {
        final acknowledged = await _uploader.upload(batch);
        if (_disposed) return;
        if (acknowledged.isNotEmpty) await _store.markSynced(acknowledged);
        uploaded += acknowledged.length;
        attempt = 0;
        if (acknowledged.length < batch.length) {
          // The server kept part of the batch. Stopping here rather than
          // looping keeps the rest pending instead of hammering at it.
          return await _publish(
            TriviaSyncPhase.idle,
            TriviaSyncOutcome.success,
            uploaded,
            attempt,
            'partialAcknowledgement',
          );
        }
      } on TriviaSyncException catch (error) {
        if (_disposed) return;
        if (error.kind == TriviaSyncFailureKind.transient &&
            attempt + 1 < _maxAttempts) {
          attempt++;
          await _publish(
            TriviaSyncPhase.retrying,
            TriviaSyncOutcome.transientFailure,
            uploaded,
            attempt,
            error.code,
          );
          await _retryWaiter.wait(_jitter(retryBackoff(attempt)));
          if (_disposed) return;
          continue;
        }
        return await _publish(
          TriviaSyncPhase.stopped,
          switch (error.kind) {
            TriviaSyncFailureKind.rejected => TriviaSyncOutcome.rejected,
            TriviaSyncFailureKind.cancelled => TriviaSyncOutcome.cancelled,
            TriviaSyncFailureKind.transient =>
              TriviaSyncOutcome.transientFailure,
            TriviaSyncFailureKind.permanent =>
              TriviaSyncOutcome.permanentFailure,
          },
          uploaded,
          attempt,
          error.code,
        );
      } on Object {
        if (_disposed) return;
        return await _publish(
          TriviaSyncPhase.stopped,
          TriviaSyncOutcome.permanentFailure,
          uploaded,
          attempt,
          'syncFailure',
        );
      }
    }
  }

  /// Publishes the run's state, including how much is still waiting.
  ///
  /// The pending count is read rather than inferred: it is the number a person
  /// is owed an honest answer about, and inferring it from the batch would go
  /// wrong the moment an answer is recorded mid-sync.
  Future<void> _publish(
    TriviaSyncPhase phase,
    TriviaSyncOutcome outcome,
    int uploaded,
    int attempt,
    String? reason,
  ) async {
    if (_disposed) return;
    var pending = 0;
    try {
      pending = (await _store.readPending(limit: _unlimited)).length;
    } on Object {
      pending = 0;
    }
    if (_disposed) return;
    _state.value = TriviaSyncState(
      phase: phase,
      outcome: outcome,
      uploadedCount: uploaded,
      pendingCount: pending,
      attempt: attempt,
      reasonCode: reason,
    );
  }
}
