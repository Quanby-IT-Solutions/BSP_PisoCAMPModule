import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/utils/retry_waiter.dart';
import 'package:mobile/features/pisocamp/data/survey_repository.dart';
import 'package:mobile/features/pisocamp/data/survey_response.dart';
import 'package:mobile/features/pisocamp/data/survey_response_queue.dart';
import 'package:mobile/features/pisocamp/data/survey_sync_controller.dart';

import 'survey_response_queue_test.dart' show response;

final class _MemoryQueue implements SurveyQueuePort {
  final List<SurveyResponse> records = [];
  Object? readFailure;

  @override
  Future<void> enqueue(SurveyResponse record) async {
    if (records.any((entry) => entry.responseId == record.responseId)) return;
    records.add(record);
  }

  @override
  Future<List<SurveyResponse>> readBatch() async {
    final failure = readFailure;
    if (failure != null) throw failure;
    return records.take(20).toList();
  }

  @override
  Future<void> acknowledge(Iterable<String> responseIds) async {
    final acknowledged = responseIds.toSet();
    records.removeWhere((entry) => acknowledged.contains(entry.responseId));
  }

  @override
  Future<int> pendingCount() async => records.length;
}

final class _RecordingUploader implements SurveyUploadPort {
  final List<List<String>> batches = [];
  final Set<String> held = {};
  List<String> Function(int attempt, List<SurveyResponse> batch)? onUpload;
  var attempts = 0;

  @override
  Future<List<String>> upload(List<SurveyResponse> responses) async {
    attempts += 1;
    batches.add([for (final entry in responses) entry.responseId]);
    final handler = onUpload;
    if (handler != null) return handler(attempts, responses);
    held.addAll(batches.last);
    return batches.last;
  }
}

final class _ImmediateWaiter implements RetryWaiter {
  var waits = 0;

  @override
  Future<void> wait(Duration delay) async => waits += 1;

  @override
  void cancel() {}
}

void main() {
  late _MemoryQueue queue;
  late _RecordingUploader uploader;
  late _ImmediateWaiter waiter;
  var online = true;

  SurveySyncController build() => SurveySyncController(
    queue: queue,
    uploader: uploader,
    isOnline: () => online,
    retryWaiter: waiter,
    jitter: (delay) => delay,
  );

  setUp(() {
    queue = _MemoryQueue();
    uploader = _RecordingUploader();
    waiter = _ImmediateWaiter();
    online = true;
  });

  group('submitting', () {
    test('queues the response before anything is uploaded', () async {
      final controller = build();
      addTearDown(controller.dispose);

      await controller.submit(response(1));

      expect(uploader.batches.single, [response(1).responseId]);
      expect(queue.records, isEmpty, reason: 'acknowledged, so deleted');
    });

    test('queues it offline and uploads nothing', () async {
      online = false;
      final controller = build();
      addTearDown(controller.dispose);

      await controller.submit(response(1));

      expect(queue.records, hasLength(1));
      expect(uploader.attempts, 0);
      expect(controller.state.value.reasonCode, 'offline');
      expect(controller.state.value.pendingCount, 1);
    });
  });

  group('an offline response reaching the server', () {
    test('uploads the backlog once when connectivity returns', () async {
      online = false;
      final controller = build();
      addTearDown(controller.dispose);
      await controller.submit(response(1));
      await controller.submit(response(2));

      online = true;
      await controller.sync(SurveySyncTrigger.reconnect);
      await controller.sync(SurveySyncTrigger.reconnect);

      expect(uploader.batches, hasLength(1));
      expect(uploader.held, {response(1).responseId, response(2).responseId});
      expect(queue.records, isEmpty);
    });

    test('re-sending a batch the server already holds stores it once', () async {
      // The interrupted-acknowledgement case: the server stored the batch and
      // the device never heard so.
      final controller = build();
      addTearDown(controller.dispose);
      await queue.enqueue(response(1));
      uploader.onUpload = (attempt, batch) {
        uploader.held.addAll([for (final entry in batch) entry.responseId]);
        if (attempt == 1) {
          throw const SurveySyncException(
            SurveySyncFailureKind.transient,
            'timeout',
          );
        }
        return [for (final entry in batch) entry.responseId];
      };

      await controller.sync(SurveySyncTrigger.startup);

      expect(uploader.attempts, 2);
      expect(uploader.held, {response(1).responseId});
      expect(queue.records, isEmpty);
    });

    test('keeps anything the server did not acknowledge', () async {
      uploader.onUpload = (_, batch) => [batch.first.responseId];
      final controller = build();
      addTearDown(controller.dispose);
      await queue.enqueue(response(1));
      await queue.enqueue(response(2));

      await controller.sync(SurveySyncTrigger.startup);

      expect(queue.records.map((entry) => entry.responseId), [
        response(2).responseId,
      ]);
      expect(controller.state.value.reasonCode, 'partialAcknowledgement');
    });
  });

  group('a submission the server will not take', () {
    test('is refused without retrying, and nothing is deleted', () async {
      uploader.onUpload = (_, _) => throw const SurveySyncException(
        SurveySyncFailureKind.refused,
        'consentRequired',
      );
      final controller = build();
      addTearDown(controller.dispose);
      await queue.enqueue(response(1));

      await controller.sync(SurveySyncTrigger.startup);

      // A consent that is not there will not be there a second later either.
      expect(uploader.attempts, 1);
      expect(queue.records, hasLength(1));
      expect(controller.state.value.outcome, SurveySyncOutcome.refused);
      expect(controller.state.value.reasonCode, 'consentRequired');
    });

    test('retries a transient failure and gives up after the cap', () async {
      uploader.onUpload = (_, _) => throw const SurveySyncException(
        SurveySyncFailureKind.transient,
        'network',
      );
      final controller = build();
      addTearDown(controller.dispose);
      await queue.enqueue(response(1));

      await controller.sync(SurveySyncTrigger.startup);

      expect(uploader.attempts, 4);
      expect(waiter.waits, 3);
      expect(queue.records, hasLength(1));
    });

    test('does not retry a permanent failure', () async {
      uploader.onUpload = (_, _) => throw const SurveySyncException(
        SurveySyncFailureKind.permanent,
        'invalidAcknowledgement',
      );
      final controller = build();
      addTearDown(controller.dispose);
      await queue.enqueue(response(1));

      await controller.sync(SurveySyncTrigger.startup);

      expect(uploader.attempts, 1);
      expect(queue.records, hasLength(1));
    });

    test('stops when the queue cannot be read', () async {
      queue.readFailure = StateError('unreadable');
      final controller = build();
      addTearDown(controller.dispose);

      await controller.sync(SurveySyncTrigger.startup);

      expect(uploader.attempts, 0);
      expect(controller.state.value.reasonCode, 'queueUnreadable');
    });
  });

  test('a request arriving mid-run is not swallowed', () async {
    final controller = build();
    addTearDown(controller.dispose);
    await queue.enqueue(response(1));

    final first = controller.sync(SurveySyncTrigger.startup);
    final second = controller.sync(SurveySyncTrigger.reconnect);
    await Future.wait([first, second]);

    // The second run finds nothing left, but it does run: a reconnect landing
    // during a run that already gave up would otherwise be lost.
    expect(queue.records, isEmpty);
    expect(controller.state.value.outcome, SurveySyncOutcome.success);
  });
}
