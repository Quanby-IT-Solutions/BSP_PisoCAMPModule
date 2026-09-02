import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:mobile/core/utils/retry_waiter.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_repository.dart';

final _analyticsUuidV4Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);

@visibleForTesting
bool isAnalyticsUuidV4(String value) => _analyticsUuidV4Pattern.hasMatch(value);

abstract interface class AnalyticsQueuePort {
  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = 100,
    int maxBytes = 512 * 1024,
  });
  Future<void> acknowledge(Iterable<String> eventIds);
}

/// The shared retry waiter, under the name AN-1 introduced it.
typedef AnalyticsRetryWaiter = RetryWaiter;
typedef TimerAnalyticsRetryWaiter = TimerRetryWaiter;

enum AnalyticsSyncTrigger { startup, reconnect, manual }

enum AnalyticsSyncPhase { idle, syncing, retrying, stopped, disposed }

enum AnalyticsSyncOutcome {
  none,
  success,
  offline,
  transientFailure,
  permanentFailure,
  cancelled,
}

final class AnalyticsSyncState {
  const AnalyticsSyncState({
    this.phase = AnalyticsSyncPhase.idle,
    this.outcome = AnalyticsSyncOutcome.none,
    this.batchCount = 0,
    this.acknowledgedCount = 0,
    this.attempt = 0,
    this.duration = Duration.zero,
    this.httpStatusClass,
    this.reasonCode,
  });
  final AnalyticsSyncPhase phase;
  final AnalyticsSyncOutcome outcome;
  final int batchCount;
  final int acknowledgedCount;
  final int attempt;
  final Duration duration;
  final int? httpStatusClass;
  final String? reasonCode;
}

final class AnalyticsSyncController {
  AnalyticsSyncController({
    required AnalyticsQueuePort queue,
    required AnalyticsUploadPort uploader,
    required bool Function() isOnline,
    AnalyticsRetryWaiter? retryWaiter,
    Duration Function(Duration)? jitter,
    Duration Function()? monotonicElapsed,
  }) : _queue = queue,
       _uploader = uploader,
       _isOnline = isOnline,
       _retryWaiter = retryWaiter ?? TimerRetryWaiter(),
       _jitter = jitter ?? secureRetryJitter,
       _elapsedOverride = monotonicElapsed;

  final AnalyticsQueuePort _queue;
  final AnalyticsUploadPort _uploader;
  final bool Function() _isOnline;
  final AnalyticsRetryWaiter _retryWaiter;
  final Duration Function(Duration) _jitter;
  final Duration Function()? _elapsedOverride;
  final Stopwatch _stopwatch = Stopwatch()..start();
  final ValueNotifier<AnalyticsSyncState> _state = ValueNotifier(
    const AnalyticsSyncState(),
  );
  Future<void>? _active;
  var _disposed = false;
  var _reconnectEpoch = 0;

  ValueListenable<AnalyticsSyncState> get state => _state;

  Future<void> sync(AnalyticsSyncTrigger trigger) {
    final active = _active;
    if (active != null) {
      if (trigger == AnalyticsSyncTrigger.reconnect) {
        _reconnectEpoch++;
        _retryWaiter.cancel();
      }
      return active;
    }
    late final Future<void> run;
    run = _drain(trigger).whenComplete(() {
      if (identical(_active, run)) _active = null;
    });
    _active = run;
    return run;
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _retryWaiter.cancel();
    _state.value = const AnalyticsSyncState(
      phase: AnalyticsSyncPhase.disposed,
      outcome: AnalyticsSyncOutcome.cancelled,
      reasonCode: 'disposed',
    );
    _state.dispose();
  }

  Future<void> _drain(AnalyticsSyncTrigger trigger) async {
    var attempt = 0;
    var batchCount = 0;
    var acknowledgedCount = 0;
    final started = _now();
    while (!_disposed) {
      if (!_isOnline()) {
        _publish(
          AnalyticsSyncPhase.stopped,
          AnalyticsSyncOutcome.offline,
          batchCount,
          acknowledgedCount,
          attempt,
          started,
          'offline',
        );
        return;
      }
      late List<AnalyticsEvent> batch;
      try {
        batch = await _queue.readBatch();
      } on Object {
        if (_disposed) return;
        _publish(
          AnalyticsSyncPhase.stopped,
          AnalyticsSyncOutcome.permanentFailure,
          batchCount,
          acknowledgedCount,
          attempt,
          started,
          'syncFailure',
        );
        return;
      }
      if (_disposed) return;
      if (batch.isEmpty) {
        _publish(
          AnalyticsSyncPhase.idle,
          AnalyticsSyncOutcome.success,
          batchCount,
          acknowledgedCount,
          attempt,
          started,
          null,
        );
        return;
      }
      batchCount++;
      while (!_disposed) {
        _publish(
          AnalyticsSyncPhase.syncing,
          AnalyticsSyncOutcome.none,
          batchCount,
          acknowledgedCount,
          attempt,
          started,
          null,
        );
        final uploadEpoch = _reconnectEpoch;
        try {
          final acknowledged = await _uploader.upload(
            List<AnalyticsEvent>.unmodifiable(batch),
          );
          if (_disposed) return;
          if (!_validAck(acknowledged, batch)) {
            _publish(
              AnalyticsSyncPhase.stopped,
              AnalyticsSyncOutcome.permanentFailure,
              batchCount,
              acknowledgedCount,
              attempt,
              started,
              'invalidAcknowledgement',
            );
            return;
          }
          if (acknowledged.isNotEmpty) await _queue.acknowledge(acknowledged);
          acknowledgedCount += acknowledged.length;
          if (acknowledged.length != batch.length || batch.length < 100) {
            _publish(
              AnalyticsSyncPhase.idle,
              AnalyticsSyncOutcome.success,
              batchCount,
              acknowledgedCount,
              attempt,
              started,
              null,
            );
            return;
          }
          attempt = 0;
          break;
        } on AnalyticsRepositoryException catch (error) {
          if (_disposed) return;
          if (error.kind != AnalyticsRepositoryFailureKind.transient) {
            _publish(
              AnalyticsSyncPhase.stopped,
              error.kind == AnalyticsRepositoryFailureKind.cancelled
                  ? AnalyticsSyncOutcome.cancelled
                  : AnalyticsSyncOutcome.permanentFailure,
              batchCount,
              acknowledgedCount,
              attempt,
              started,
              error.code,
              error.httpStatusClass,
            );
            return;
          }
          if (_reconnectEpoch != uploadEpoch) {
            attempt = 0;
            continue;
          }
          attempt++;
          _publish(
            AnalyticsSyncPhase.retrying,
            AnalyticsSyncOutcome.transientFailure,
            batchCount,
            acknowledgedCount,
            attempt,
            started,
            error.code,
            error.httpStatusClass,
          );
          final delay = _jitter(retryBackoff(attempt));
          final retryEpoch = _reconnectEpoch;
          await _retryWaiter.wait(delay);
          if (_reconnectEpoch != retryEpoch) {
            attempt = 0;
          }
          if (_disposed) return;
          if (!_isOnline()) {
            _publish(
              AnalyticsSyncPhase.stopped,
              AnalyticsSyncOutcome.offline,
              batchCount,
              acknowledgedCount,
              attempt,
              started,
              'offline',
            );
            return;
          }
        } on Object {
          if (_disposed) return;
          _publish(
            AnalyticsSyncPhase.stopped,
            AnalyticsSyncOutcome.permanentFailure,
            batchCount,
            acknowledgedCount,
            attempt,
            started,
            'syncFailure',
          );
          return;
        }
      }
    }
  }

  bool _validAck(List<String> ids, List<AnalyticsEvent> batch) {
    final submitted = batch.map((event) => event.eventId).toSet();
    return ids.toSet().length == ids.length &&
        ids.every((id) => isAnalyticsUuidV4(id) && submitted.contains(id));
  }

  void _publish(
    AnalyticsSyncPhase phase,
    AnalyticsSyncOutcome outcome,
    int batches,
    int acknowledged,
    int attempt,
    Duration started,
    String? reason, [
    int? status,
  ]) {
    _state.value = AnalyticsSyncState(
      phase: phase,
      outcome: outcome,
      batchCount: batches,
      acknowledgedCount: acknowledged,
      attempt: attempt,
      duration: _now() - started,
      reasonCode: reason,
      httpStatusClass: status,
    );
  }

  Duration _now() => _elapsedOverride?.call() ?? _stopwatch.elapsed;
}
