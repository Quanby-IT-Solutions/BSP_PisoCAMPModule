import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:mobile/core/utils/retry_waiter.dart';
import 'package:mobile/features/pisocamp/data/survey_repository.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';
import 'package:mobile/features/pisocamp/data/survey_response_queue.dart';

enum SurveySyncTrigger { startup, reconnect, submitted }

enum SurveySyncPhase { idle, syncing, retrying, stopped, disposed }

enum SurveySyncOutcome {
  none,
  success,

  /// Nothing was attempted: no connection.
  skipped,
  transientFailure,
  permanentFailure,

  /// The server would not take it. Everything stays queued.
  refused,
  cancelled,
}

@immutable
final class SurveySyncState {
  const SurveySyncState({
    this.phase = SurveySyncPhase.idle,
    this.outcome = SurveySyncOutcome.none,
    this.uploadedCount = 0,
    this.pendingCount = 0,
    this.attempt = 0,
    this.reasonCode,
  });

  final SurveySyncPhase phase;
  final SurveySyncOutcome outcome;
  final int uploadedCount;
  final int pendingCount;
  final int attempt;
  final String? reasonCode;
}

/// Uploads queued responses, and deletes only what the server acknowledged.
///
/// A survey response is somebody's considered answer given under a privacy
/// notice; the device holds it until the server says it has it, and never the
/// other way round.
final class SurveySyncController {
  SurveySyncController({
    required SurveyQueuePort queue,
    required SurveyUploadPort uploader,
    required bool Function() isOnline,
    RetryWaiter? retryWaiter,
    Duration Function(Duration)? jitter,
    int maxAttempts = 4,
  }) : _queue = queue,
       _uploader = uploader,
       _isOnline = isOnline,
       _retryWaiter = retryWaiter ?? TimerRetryWaiter(),
       _jitter = jitter ?? secureRetryJitter,
       _maxAttempts = maxAttempts;

  final SurveyQueuePort _queue;
  final SurveyUploadPort _uploader;
  final bool Function() _isOnline;
  final RetryWaiter _retryWaiter;
  final Duration Function(Duration) _jitter;
  final int _maxAttempts;
  final ValueNotifier<SurveySyncState> _state = ValueNotifier(
    const SurveySyncState(),
  );
  Future<void>? _active;
  var _disposed = false;

  /// Set when a sync is asked for while one is already running, so a reconnect
  /// that lands mid-run is not swallowed by the run that already gave up.
  var _rerunRequested = false;

  ValueListenable<SurveySyncState> get state => _state;

  /// Queues one response, then offers to upload it.
  ///
  /// Queuing never depends on the upload: offline, or refused, the answer is
  /// still the person's and it is still kept.
  Future<void> submit(SurveyResponse response) async {
    await _queue.enqueue(response);
    await sync(SurveySyncTrigger.submitted);
  }

  Future<void> sync(SurveySyncTrigger trigger) {
    final active = _active;
    if (active != null) {
      _rerunRequested = true;
      if (trigger == SurveySyncTrigger.reconnect) _retryWaiter.cancel();
      return active;
    }
    late final Future<void> run;
    run = _runUntilSettled(trigger).whenComplete(() {
      if (identical(_active, run)) _active = null;
    });
    _active = run;
    return run;
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _retryWaiter.cancel();
    _state.value = const SurveySyncState(
      phase: SurveySyncPhase.disposed,
      outcome: SurveySyncOutcome.cancelled,
      reasonCode: 'disposed',
    );
    _state.dispose();
  }

  Future<void> _runUntilSettled(SurveySyncTrigger trigger) async {
    _rerunRequested = false;
    await _drain();
    while (_rerunRequested && !_disposed) {
      _rerunRequested = false;
      await _drain();
    }
  }

  Future<void> _drain() async {
    var uploaded = 0;
    var attempt = 0;
    while (!_disposed) {
      if (!_isOnline()) {
        return await _publish(
          SurveySyncPhase.stopped,
          SurveySyncOutcome.skipped,
          uploaded,
          attempt,
          'offline',
        );
      }

      late List<SurveyResponse> batch;
      try {
        batch = await _queue.readBatch();
      } on Object {
        return await _publish(
          SurveySyncPhase.stopped,
          SurveySyncOutcome.permanentFailure,
          uploaded,
          attempt,
          'queueUnreadable',
        );
      }
      if (_disposed) return;
      if (batch.isEmpty) {
        return await _publish(
          SurveySyncPhase.idle,
          SurveySyncOutcome.success,
          uploaded,
          attempt,
          null,
        );
      }

      await _publish(
        SurveySyncPhase.syncing,
        SurveySyncOutcome.none,
        uploaded,
        attempt,
        null,
      );
      try {
        final acknowledged = await _uploader.upload(batch);
        if (_disposed) return;
        if (acknowledged.isNotEmpty) await _queue.acknowledge(acknowledged);
        uploaded += acknowledged.length;
        attempt = 0;
        if (acknowledged.length < batch.length) {
          return await _publish(
            SurveySyncPhase.idle,
            SurveySyncOutcome.success,
            uploaded,
            attempt,
            'partialAcknowledgement',
          );
        }
      } on SurveySyncException catch (error) {
        if (_disposed) return;
        if (error.kind == SurveySyncFailureKind.transient &&
            attempt + 1 < _maxAttempts) {
          attempt++;
          await _publish(
            SurveySyncPhase.retrying,
            SurveySyncOutcome.transientFailure,
            uploaded,
            attempt,
            error.code,
          );
          await _retryWaiter.wait(_jitter(retryBackoff(attempt)));
          if (_disposed) return;
          continue;
        }
        return await _publish(
          SurveySyncPhase.stopped,
          switch (error.kind) {
            SurveySyncFailureKind.refused => SurveySyncOutcome.refused,
            SurveySyncFailureKind.cancelled => SurveySyncOutcome.cancelled,
            SurveySyncFailureKind.transient =>
              SurveySyncOutcome.transientFailure,
            SurveySyncFailureKind.permanent =>
              SurveySyncOutcome.permanentFailure,
          },
          uploaded,
          attempt,
          error.code,
        );
      } on Object {
        if (_disposed) return;
        return await _publish(
          SurveySyncPhase.stopped,
          SurveySyncOutcome.permanentFailure,
          uploaded,
          attempt,
          'syncFailure',
        );
      }
    }
  }

  Future<void> _publish(
    SurveySyncPhase phase,
    SurveySyncOutcome outcome,
    int uploaded,
    int attempt,
    String? reason,
  ) async {
    if (_disposed) return;
    var pending = 0;
    try {
      pending = await _queue.pendingCount();
    } on Object {
      pending = 0;
    }
    if (_disposed) return;
    _state.value = SurveySyncState(
      phase: phase,
      outcome: outcome,
      uploadedCount: uploaded,
      pendingCount: pending,
      attempt: attempt,
      reasonCode: reason,
    );
  }
}
