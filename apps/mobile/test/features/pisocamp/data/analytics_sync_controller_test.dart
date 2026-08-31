import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_repository.dart';
import 'package:mobile/features/pisocamp/data/analytics_sync_controller.dart';

void main() {
  test(
    'concurrent triggers share one upload and acknowledge server IDs once',
    () async {
      final queue = _Queue(<AnalyticsEvent>[_event(1)]);
      final completion = Completer<List<String>>();
      final uploader = _Uploader((_) => completion.future);
      final controller = AnalyticsSyncController(
        queue: queue,
        uploader: uploader,
        isOnline: () => true,
        jitter: (value) => value,
      );
      final first = controller.sync(AnalyticsSyncTrigger.startup);
      final second = controller.sync(AnalyticsSyncTrigger.manual);
      expect(identical(first, second), isTrue);
      completion.complete(<String>[_id(1)]);
      await first;
      expect(uploader.calls, 1);
      expect(queue.acknowledged, <String>[_id(1)]);
    },
  );
  test('disposal prevents a late acknowledgement', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1)]);
    final completion = Completer<List<String>>();
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: _Uploader((_) => completion.future),
      isOnline: () => true,
    );
    final active = controller.sync(AnalyticsSyncTrigger.startup);
    controller.dispose();
    completion.complete(<String>[_id(1)]);
    await active;
    expect(queue.acknowledged, isEmpty);
  });

  test('offline does not read queue or upload', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1)]);
    final uploader = _Uploader((_) async => <String>[_id(1)]);
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: uploader,
      isOnline: () => false,
    );
    await controller.sync(AnalyticsSyncTrigger.startup);
    expect(queue.reads, 0);
    expect(uploader.calls, 0);
  });

  test('partial acknowledgements delete only returned IDs and stop', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1), _event(2)]);
    final uploader = _Uploader((_) async => <String>[_id(1)]);
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: uploader,
      isOnline: () => true,
    );
    await controller.sync(AnalyticsSyncTrigger.startup);
    expect(queue.acknowledged, <String>[_id(1)]);
    expect(uploader.calls, 1);
  });

  test(
    'reconnect cancels a retry wait and retries the same immutable IDs',
    () async {
      final queue = _Queue(<AnalyticsEvent>[_event(1)]);
      final waiter = _Waiter();
      var call = 0;
      final uploader = _Uploader((events) async {
        call++;
        if (call == 1) {
          throw const AnalyticsRepositoryException(
            AnalyticsRepositoryFailureKind.transient,
            'timeout',
          );
        }
        return events.map((event) => event.eventId).toList();
      });
      final controller = AnalyticsSyncController(
        queue: queue,
        uploader: uploader,
        isOnline: () => true,
        retryWaiter: waiter,
        jitter: (value) => value,
      );
      final active = controller.sync(AnalyticsSyncTrigger.startup);
      await waiter.started.future;
      expect(
        identical(active, controller.sync(AnalyticsSyncTrigger.reconnect)),
        isTrue,
      );
      await active;
      expect(waiter.cancelled, isTrue);
      expect(uploader.batches.map((batch) => batch.single.eventId), <String>[
        _id(1),
        _id(1),
      ]);
    },
  );
  test('a full 100-event acknowledgement continues to a final batch', () async {
    final first = List<AnalyticsEvent>.generate(100, _event);
    final queue = _BatchedQueue(<List<AnalyticsEvent>>[
      first,
      <AnalyticsEvent>[_event(101)],
    ]);
    await AnalyticsSyncController(
      queue: queue,
      uploader: _Uploader(
        (events) async => events.map((e) => e.eventId).toList(),
      ),
      isOnline: () => true,
    ).sync(AnalyticsSyncTrigger.startup);
    expect(queue.reads, 2);
    expect(queue.acknowledged, hasLength(101));
  });

  test(
    'timeout resends immutable IDs and later acknowledges exactly once',
    () async {
      final queue = _Queue(<AnalyticsEvent>[_event(1)]);
      final waiter = _ImmediateWaiter();
      var calls = 0;
      final uploader = _Uploader((events) async {
        if (calls++ == 0) {
          throw const AnalyticsRepositoryException(
            AnalyticsRepositoryFailureKind.transient,
            'timeout',
          );
        }
        return events.map((e) => e.eventId).toList();
      });
      await AnalyticsSyncController(
        queue: queue,
        uploader: uploader,
        isOnline: () => true,
        retryWaiter: waiter,
        jitter: (d) => d,
      ).sync(AnalyticsSyncTrigger.startup);
      expect(uploader.batches.map((batch) => batch.single.eventId), <String>[
        _id(1),
        _id(1),
      ]);
      expect(queue.acknowledged, <String>[_id(1)]);
    },
  );

  test(
    'backoff reaches 300 seconds and deterministic jitter is applied',
    () async {
      final queue = _Queue(<AnalyticsEvent>[_event(1)]);
      final waiter = _ImmediateWaiter();
      var calls = 0;
      await AnalyticsSyncController(
        queue: queue,
        uploader: _Uploader((events) async {
          if (calls++ < 10) {
            throw const AnalyticsRepositoryException(
              AnalyticsRepositoryFailureKind.transient,
              'network',
            );
          }
          return events.map((e) => e.eventId).toList();
        }),
        isOnline: () => true,
        retryWaiter: waiter,
        jitter: (d) => Duration(milliseconds: d.inMilliseconds * 80 ~/ 100),
      ).sync(AnalyticsSyncTrigger.startup);
      expect(waiter.delays.map((d) => d.inSeconds), <int>[
        0,
        1,
        3,
        6,
        12,
        25,
        51,
        102,
        204,
        240,
      ]);
    },
  );

  test('foreign duplicate and 4xx responses retain without retrying', () async {
    for (final result in <Object>[
      <String>[_id(2)],
      <String>[_id(1), _id(1)],
      const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.permanent,
        'http4xx',
        httpStatusClass: 4,
      ),
    ]) {
      final queue = _Queue(<AnalyticsEvent>[_event(1)]);
      final uploader = _Uploader((_) async {
        if (result is AnalyticsRepositoryException) throw result;
        return result as List<String>;
      });
      await AnalyticsSyncController(
        queue: queue,
        uploader: uploader,
        isOnline: () => true,
      ).sync(AnalyticsSyncTrigger.startup);
      expect(queue.acknowledged, isEmpty);
      expect(uploader.calls, 1);
    }
  });

  test(
    'dispose during retry wait cancels it and clears the active drain',
    () async {
      final queue = _Queue(<AnalyticsEvent>[_event(1)]);
      final waiter = _Waiter();
      final controller = AnalyticsSyncController(
        queue: queue,
        uploader: _Uploader(
          (_) async => throw const AnalyticsRepositoryException(
            AnalyticsRepositoryFailureKind.transient,
            'network',
          ),
        ),
        isOnline: () => true,
        retryWaiter: waiter,
      );
      final active = controller.sync(AnalyticsSyncTrigger.startup);
      await waiter.started.future;
      controller.dispose();
      await active;
      expect(waiter.cancelled, isTrue);
      expect(queue.acknowledged, isEmpty);
    },
  );
  test('cancellation retains the batch and permits a later trigger', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1)]);
    final uploader = _Uploader(
      (_) async => throw const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.cancelled,
        'cancelled',
      ),
    );
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: uploader,
      isOnline: () => true,
    );
    await controller.sync(AnalyticsSyncTrigger.startup);
    await controller.sync(AnalyticsSyncTrigger.manual);
    expect(uploader.calls, 2);
    expect(queue.acknowledged, isEmpty);
    expect(controller.state.value.reasonCode, 'cancelled');
  });

  test('transient 5xx state contains only approved metadata', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1)]);
    final waiter = _Waiter();
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: _Uploader(
        (_) async => throw const AnalyticsRepositoryException(
          AnalyticsRepositoryFailureKind.transient,
          'http5xx',
          httpStatusClass: 5,
        ),
      ),
      isOnline: () => true,
      retryWaiter: waiter,
    );
    final active = controller.sync(AnalyticsSyncTrigger.startup);
    await waiter.started.future;
    expect(controller.state.value.reasonCode, 'http5xx');
    expect(controller.state.value.httpStatusClass, 5);
    expect(controller.state.value.acknowledgedCount, 0);
    controller.dispose();
    await active;
  });
  test(
    'a successful full batch resets the next batch retry to one second',
    () async {
      final first = List<AnalyticsEvent>.generate(100, _event);
      final second = List<AnalyticsEvent>.generate(99, (i) => _event(i + 100));
      final queue = _BatchedQueue(<List<AnalyticsEvent>>[first, second]);
      final waiter = _ImmediateWaiter();
      var calls = 0;
      await AnalyticsSyncController(
        queue: queue,
        uploader: _Uploader((events) async {
          calls++;
          if (calls == 1 || calls == 3) {
            throw const AnalyticsRepositoryException(
              AnalyticsRepositoryFailureKind.transient,
              'timeout',
            );
          }
          return events.map((e) => e.eventId).toList();
        }),
        isOnline: () => true,
        retryWaiter: waiter,
        jitter: (d) => d,
      ).sync(AnalyticsSyncTrigger.startup);
      expect(waiter.delays, <Duration>[
        const Duration(seconds: 1),
        const Duration(seconds: 1),
      ]);
    },
  );
  test('queue read failure stops safely and clears the active drain', () async {
    final queue = _FailingQueue();
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: _Uploader((_) async => <String>[]),
      isOnline: () => true,
    );
    await controller.sync(AnalyticsSyncTrigger.startup);
    await controller.sync(AnalyticsSyncTrigger.manual);
    expect(queue.reads, 2);
    expect(controller.state.value.reasonCode, 'syncFailure');
  });
  test('reconnect during upload after a retry skips the stale delay', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1)]);
    final waiter = _Waiter();
    final second = Completer<List<String>>();
    var calls = 0;
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: _Uploader((events) async {
        calls++;
        if (calls == 1) {
          throw const AnalyticsRepositoryException(
            AnalyticsRepositoryFailureKind.transient,
            'timeout',
          );
        }
        if (calls == 2) return second.future;
        return events.map((event) => event.eventId).toList();
      }),
      isOnline: () => true,
      retryWaiter: waiter,
      jitter: (delay) => delay,
    );
    final active = controller.sync(AnalyticsSyncTrigger.startup);
    await waiter.started.future;
    controller.sync(AnalyticsSyncTrigger.reconnect);
    await Future<void>.delayed(Duration.zero);
    controller.sync(AnalyticsSyncTrigger.reconnect);
    second.completeError(
      const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.transient,
        'network',
      ),
    );
    await active;
    expect(calls, 3);
    expect(queue.acknowledged, <String>[_id(1)]);
  });

  test('malformed direct uploader acknowledgement is never deleted', () async {
    final queue = _Queue(<AnalyticsEvent>[_event(1)]);
    final controller = AnalyticsSyncController(
      queue: queue,
      uploader: _Uploader((_) async => <String>['not-a-uuid']),
      isOnline: () => true,
    );
    await controller.sync(AnalyticsSyncTrigger.startup);
    expect(queue.acknowledged, isEmpty);
    expect(controller.state.value.reasonCode, 'invalidAcknowledgement');
  });
  test('offline after retry publishes stopped offline state', () async {
    var online = true;
    final waiter = _Waiter();
    final controller = AnalyticsSyncController(
      queue: _Queue(<AnalyticsEvent>[_event(1)]),
      uploader: _Uploader(
        (_) async => throw const AnalyticsRepositoryException(
          AnalyticsRepositoryFailureKind.transient,
          'network',
        ),
      ),
      isOnline: () => online,
      retryWaiter: waiter,
    );
    final active = controller.sync(AnalyticsSyncTrigger.startup);
    await waiter.started.future;
    online = false;
    waiter.cancel();
    await active;
    expect(controller.state.value.outcome, AnalyticsSyncOutcome.offline);
    expect(controller.state.value.reasonCode, 'offline');
  });

  test(
    'late typed and untyped upload errors after disposal do not publish again',
    () async {
      for (final error in <Object>[
        const AnalyticsRepositoryException(
          AnalyticsRepositoryFailureKind.transient,
          'network',
        ),
        StateError('raw'),
      ]) {
        final completion = Completer<List<String>>();
        final controller = AnalyticsSyncController(
          queue: _Queue(<AnalyticsEvent>[_event(1)]),
          uploader: _Uploader((_) => completion.future),
          isOnline: () => true,
        );
        var notices = 0;
        controller.state.addListener(() => notices++);
        final active = controller.sync(AnalyticsSyncTrigger.startup);
        await Future<void>.delayed(Duration.zero);
        controller.dispose();
        final disposedNotices = notices;
        completion.completeError(error);
        await active;
        expect(notices, disposedNotices);
      }
    },
  );

  test(
    'Timer retry waiter naturally completes and cancel is idempotent',
    () async {
      final waiter = TimerAnalyticsRetryWaiter();
      await waiter.wait(Duration.zero);
      waiter.cancel();
      final pending = waiter.wait(const Duration(days: 1));
      waiter.cancel();
      waiter.cancel();
      await pending;
    },
  );
  test('UUIDv4 predicate accepts only canonical version-four identifiers', () {
    expect(isAnalyticsUuidV4(_id(1)), isTrue);
    expect(isAnalyticsUuidV4('00000000-0000-1000-8000-000000000001'), isFalse);
    expect(isAnalyticsUuidV4('not-a-uuid'), isFalse);
  });

  test('reconnect during upload avoids a second retry wait', () async {
    final waiter = _PerWaitWaiter();
    final secondUpload = Completer<List<String>>();
    var uploads = 0;
    final controller = AnalyticsSyncController(
      queue: _Queue(<AnalyticsEvent>[_event(1)]),
      uploader: _Uploader((events) async {
        uploads++;
        if (uploads == 1) {
          throw const AnalyticsRepositoryException(
            AnalyticsRepositoryFailureKind.transient,
            'timeout',
          );
        }
        if (uploads == 2) return secondUpload.future;
        return events.map((event) => event.eventId).toList();
      }),
      isOnline: () => true,
      retryWaiter: waiter,
    );
    final active = controller.sync(AnalyticsSyncTrigger.startup);
    await waiter.waitStarted(0);
    waiter.complete(0);
    await Future<void>.delayed(Duration.zero);
    controller.sync(AnalyticsSyncTrigger.reconnect);
    secondUpload.completeError(
      const AnalyticsRepositoryException(
        AnalyticsRepositoryFailureKind.transient,
        'network',
      ),
    );
    var staleWaitObserved = false;
    try {
      await active.timeout(const Duration(milliseconds: 100));
    } on TimeoutException {
      staleWaitObserved = true;
      waiter.complete(1);
      await active;
    }
    expect(uploads, 3);
    expect(staleWaitObserved, isFalse);
    expect(waiter.waitCount, 1);
  });
}

final class _Queue implements AnalyticsQueuePort {
  _Queue(this.events);
  final List<AnalyticsEvent> events;
  final List<String> acknowledged = [];
  var reads = 0;
  @override
  Future<void> acknowledge(Iterable<String> ids) async {
    acknowledged.addAll(ids);
  }

  @override
  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = 100,
    int maxBytes = 512 * 1024,
  }) async {
    reads++;
    return List.of(events);
  }
}

final class _Uploader implements AnalyticsUploadPort {
  _Uploader(this.handler);
  final Future<List<String>> Function(List<AnalyticsEvent>) handler;
  var calls = 0;
  final List<List<AnalyticsEvent>> batches = [];
  @override
  Future<List<String>> upload(List<AnalyticsEvent> events) {
    calls++;
    batches.add(List.of(events));
    return handler(events);
  }
}

final class _Waiter implements AnalyticsRetryWaiter {
  final started = Completer<void>();
  final _done = Completer<void>();
  var cancelled = false;
  @override
  Future<void> wait(Duration delay) {
    if (!started.isCompleted) started.complete();
    return _done.future;
  }

  @override
  void cancel() {
    cancelled = true;
    if (!_done.isCompleted) _done.complete();
  }
}

final class _ImmediateWaiter implements AnalyticsRetryWaiter {
  final List<Duration> delays = [];
  @override
  Future<void> wait(Duration delay) async {
    delays.add(delay);
  }

  @override
  void cancel() {}
}

final class _BatchedQueue implements AnalyticsQueuePort {
  _BatchedQueue(this.batches);
  final List<List<AnalyticsEvent>> batches;
  final List<String> acknowledged = [];
  var reads = 0;
  @override
  Future<void> acknowledge(Iterable<String> ids) async {
    acknowledged.addAll(ids);
  }

  @override
  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = 100,
    int maxBytes = 512 * 1024,
  }) async => List.of(batches[reads++]);
}

final class _FailingQueue implements AnalyticsQueuePort {
  var reads = 0;
  @override
  Future<void> acknowledge(Iterable<String> ids) async {}
  @override
  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = 100,
    int maxBytes = 512 * 1024,
  }) async {
    reads++;
    throw StateError('local path');
  }
}

final class _PerWaitWaiter implements AnalyticsRetryWaiter {
  final List<Completer<void>> _waits = [];
  int get waitCount => _waits.length;
  @override
  Future<void> wait(Duration delay) {
    final wait = Completer<void>();
    _waits.add(wait);
    return wait.future;
  }

  Future<void> waitStarted(int index) async {
    while (_waits.length <= index) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  void complete(int index) {
    if (!_waits[index].isCompleted) _waits[index].complete();
  }

  @override
  void cancel() {
    if (_waits.isNotEmpty) complete(_waits.length - 1);
  }
}

AnalyticsEvent _event(int value) => AnalyticsEvent.build(
  intent: ContentViewIntent('currency.ngc.php-20'),
  context: const AnalyticsEventContext(
    subjectPseudoId: 'AbCdEfGhIjKlMnOpQrStUv',
    sessionId: 'f6635d24-b4d1-4f63-8a06-4026fa4e8fd6',
    accountType: AnalyticsAccountType.guest,
    appVersion: '1.0.0+1',
    osName: AnalyticsOsName.android,
    osVersion: 'Android 15',
    deviceCategory: AnalyticsDeviceCategory.phone,
    networkState: AnalyticsNetworkState.offline,
  ),
  createEventId: () => _id(value),
  clock: () => DateTime.utc(2026),
);
String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';
