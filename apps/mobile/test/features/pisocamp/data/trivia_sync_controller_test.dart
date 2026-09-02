import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/utils/retry_waiter.dart';
import 'package:mobile/features/pisocamp/data/trivia_repository.dart';
import 'package:mobile/features/pisocamp/data/trivia_response.dart';
import 'package:mobile/features/pisocamp/data/trivia_response_store.dart';
import 'package:mobile/features/pisocamp/data/trivia_sync_controller.dart';

import 'trivia_response_store_test.dart' show record;

/// An in-memory store with the same contract as the shared-preferences one.
final class _MemoryStore implements TriviaResponseStore {
  final List<TriviaResponseRecord> records = [];
  String? merged;
  Object? readFailure;

  @override
  Future<List<TriviaResponseRecord>> readAll() async => List.of(records);

  @override
  Future<void> record(TriviaResponseRecord response) async {
    if (records.any((entry) => entry.responseId == response.responseId)) return;
    records.add(response);
  }

  @override
  Future<List<TriviaResponseRecord>> readPending({int limit = 100}) async {
    final failure = readFailure;
    if (failure != null) throw failure;
    return [
      for (final entry in records)
        if (!entry.synced) entry,
    ].take(limit).toList();
  }

  @override
  Future<void> markSynced(Iterable<String> responseIds) async {
    final acknowledged = responseIds.toSet();
    for (var index = 0; index < records.length; index += 1) {
      if (acknowledged.contains(records[index].responseId)) {
        records[index] = records[index].asSynced();
      }
    }
  }

  @override
  Future<String?> readMergedAccountId() async => merged;

  @override
  Future<void> recordMerged(String accountId) async => merged = accountId;
}

final class _RecordingUploader implements TriviaUploadPort {
  final List<List<String>> batches = [];
  final Set<String> held = {};

  /// Lets a test fail a specific attempt.
  List<String> Function(int attempt, List<TriviaResponseRecord> batch)? onUpload;
  var attempts = 0;

  @override
  Future<List<String>> upload(List<TriviaResponseRecord> responses) async {
    attempts += 1;
    batches.add([for (final entry in responses) entry.responseId]);
    final handler = onUpload;
    if (handler != null) return handler(attempts, responses);
    // The server's own behaviour: the id is the primary key, so a response it
    // already holds is acknowledged again rather than stored twice.
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
  late _MemoryStore store;
  late _RecordingUploader uploader;
  late _ImmediateWaiter waiter;
  var online = true;
  TriviaSyncAccount? account = const TriviaSyncAccount(accountId: 'account-one');

  TriviaSyncController build() => TriviaSyncController(
    store: store,
    uploader: uploader,
    isOnline: () => online,
    currentAccount: () => account,
    retryWaiter: waiter,
    jitter: (delay) => delay,
  );

  setUp(() {
    store = _MemoryStore();
    uploader = _RecordingUploader();
    waiter = _ImmediateWaiter();
    online = true;
    account = const TriviaSyncAccount(accountId: 'account-one');
  });

  group('recording an answer', () {
    test('stores it before anything is uploaded', () async {
      final controller = build();
      addTearDown(controller.dispose);

      await controller.record(record(1));

      expect(store.records.single.responseId, record(1).responseId);
    });

    test('stores it for a guest, and uploads nothing', () async {
      account = null;
      final controller = build();
      addTearDown(controller.dispose);

      await controller.record(record(1));

      // A guest's answers are theirs and stay on the device. This is the
      // ordinary state of the module, not a failure.
      expect(store.records, hasLength(1));
      expect(uploader.attempts, 0);
      expect(controller.state.value.outcome, TriviaSyncOutcome.skipped);
      expect(controller.state.value.reasonCode, 'guest');
      expect(controller.state.value.pendingCount, 1);
    });

    test('stores it offline, and uploads nothing', () async {
      online = false;
      final controller = build();
      addTearDown(controller.dispose);

      await controller.record(record(1));

      expect(store.records, hasLength(1));
      expect(uploader.attempts, 0);
      expect(controller.state.value.reasonCode, 'offline');
    });
  });

  group('syncing a registered active account', () {
    test('uploads what is pending and marks only what was acknowledged', () async {
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));
      await store.record(record(2));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(uploader.batches.single, [
        record(1).responseId,
        record(2).responseId,
      ]);
      expect(store.records.every((entry) => entry.synced), isTrue);
      expect(controller.state.value.outcome, TriviaSyncOutcome.success);
      expect(controller.state.value.uploadedCount, 2);
      expect(controller.state.value.pendingCount, 0);
    });

    test('sends nothing when there is nothing pending', () async {
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1, synced: true));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(uploader.attempts, 0);
      expect(controller.state.value.outcome, TriviaSyncOutcome.success);
    });

    test('keeps anything the server did not acknowledge', () async {
      uploader.onUpload = (_, batch) => [batch.first.responseId];
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));
      await store.record(record(2));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(store.records[0].synced, isTrue);
      expect(store.records[1].synced, isFalse);
      expect(controller.state.value.pendingCount, 1);
      expect(controller.state.value.reasonCode, 'partialAcknowledgement');
    });
  });

  group('offline answers reaching the server', () {
    test('uploads the backlog once when connectivity returns, with no duplicates', () async {
      online = false;
      final controller = build();
      addTearDown(controller.dispose);
      await controller.record(record(1));
      await controller.record(record(2));
      expect(uploader.attempts, 0);

      online = true;
      await controller.sync(TriviaSyncTrigger.reconnect);
      // A second reconnect: the ordinary case on a flaky connection.
      await controller.sync(TriviaSyncTrigger.reconnect);

      expect(uploader.batches, hasLength(1));
      expect(uploader.held, {record(1).responseId, record(2).responseId});
      expect(store.records.every((entry) => entry.synced), isTrue);
    });

    test('re-sending a batch the server already holds stores it once', () async {
      // The interrupted-acknowledgement case: the server stored the batch and
      // the device never heard so. The retry is what proves the id is the key.
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));
      uploader.onUpload = (attempt, batch) {
        uploader.held.addAll([for (final entry in batch) entry.responseId]);
        if (attempt == 1) {
          throw const TriviaSyncException(
            TriviaSyncFailureKind.transient,
            'timeout',
          );
        }
        return [for (final entry in batch) entry.responseId];
      };

      await controller.sync(TriviaSyncTrigger.startup);

      expect(uploader.attempts, 2);
      expect(uploader.held, {record(1).responseId});
      expect(store.records.single.synced, isTrue);
      expect(controller.state.value.outcome, TriviaSyncOutcome.success);
    });
  });

  group('an account that may not sync', () {
    test('is rejected, and the device keeps everything', () async {
      uploader.onUpload = (_, _) => throw const TriviaSyncException(
        TriviaSyncFailureKind.rejected,
        'accountNotPermitted',
        httpStatusClass: 4,
      );
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));
      await store.record(record(2));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(store.records.every((entry) => !entry.synced), isTrue);
      expect(controller.state.value.outcome, TriviaSyncOutcome.rejected);
      expect(controller.state.value.reasonCode, 'accountNotPermitted');
      expect(controller.state.value.pendingCount, 2);
      // Not retried: a deactivated account will be deactivated next second too.
      expect(uploader.attempts, 1);
    });

    test('goes on recording answers after the rejection', () async {
      uploader.onUpload = (_, _) => throw const TriviaSyncException(
        TriviaSyncFailureKind.rejected,
        'accountNotPermitted',
      );
      final controller = build();
      addTearDown(controller.dispose);

      await controller.record(record(1));
      await controller.record(record(2));

      expect(store.records, hasLength(2));
      expect(store.records.every((entry) => !entry.synced), isTrue);
    });
  });

  group('failures', () {
    test('retries a transient failure and gives up after the cap', () async {
      uploader.onUpload = (_, _) => throw const TriviaSyncException(
        TriviaSyncFailureKind.transient,
        'network',
      );
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(uploader.attempts, 4);
      expect(waiter.waits, 3);
      expect(controller.state.value.outcome, TriviaSyncOutcome.transientFailure);
      expect(store.records.single.synced, isFalse);
    });

    test('does not retry a permanent failure', () async {
      uploader.onUpload = (_, _) => throw const TriviaSyncException(
        TriviaSyncFailureKind.permanent,
        'invalidAcknowledgement',
      );
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(uploader.attempts, 1);
      expect(controller.state.value.outcome, TriviaSyncOutcome.permanentFailure);
      expect(store.records.single.synced, isFalse);
    });

    test('stops when the local store cannot be read', () async {
      store.readFailure = StateError('unreadable');
      final controller = build();
      addTearDown(controller.dispose);

      await controller.sync(TriviaSyncTrigger.startup);

      expect(uploader.attempts, 0);
      expect(controller.state.value.outcome, TriviaSyncOutcome.permanentFailure);
    });

    test('an unexpected error stops the run without losing anything', () async {
      uploader.onUpload = (_, _) => throw StateError('boom');
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));

      await controller.sync(TriviaSyncTrigger.startup);

      expect(controller.state.value.reasonCode, 'syncFailure');
      expect(store.records.single.synced, isFalse);
    });
  });

  group('the guest-to-registered merge', () {
    test('uploads the backlog under the new account, once', () async {
      account = null;
      final controller = build();
      addTearDown(controller.dispose);
      await controller.record(record(1));
      await controller.record(record(2));
      expect(uploader.attempts, 0);

      account = const TriviaSyncAccount(accountId: 'account-one');
      await controller.mergeIntoAccount('account-one');
      await controller.mergeIntoAccount('account-one');

      expect(uploader.batches, hasLength(1));
      expect(store.merged, 'account-one');
      expect(store.records.every((entry) => entry.synced), isTrue);
    });

    test('does not hand a second account the first account\'s answers', () async {
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));
      await controller.mergeIntoAccount('account-one');
      await store.record(record(2));

      await controller.mergeIntoAccount('account-two');

      // The backlog was claimed once. Answers recorded afterwards still sync
      // for whoever is signed in; what does not happen is a second account
      // inheriting the first one's history.
      expect(store.merged, 'account-one');
      expect(uploader.batches, hasLength(1));
      expect(store.records[1].synced, isFalse);
    });

    test('the ids do not change, so the merge cannot double-count', () async {
      account = null;
      final controller = build();
      addTearDown(controller.dispose);
      await controller.record(record(1));
      final beforeMerge = store.records.single.responseId;

      account = const TriviaSyncAccount(accountId: 'account-one');
      await controller.mergeIntoAccount('account-one');

      expect(store.records.single.responseId, beforeMerge);
      expect(uploader.held, {beforeMerge});
    });
  });

  group('concurrency and lifecycle', () {
    test('joins a run already in flight rather than starting a second', () async {
      final gate = Completer<void>();
      uploader.onUpload = (_, batch) {
        gate.complete();
        return [for (final entry in batch) entry.responseId];
      };
      final controller = build();
      addTearDown(controller.dispose);
      await store.record(record(1));

      final first = controller.sync(TriviaSyncTrigger.startup);
      final second = controller.sync(TriviaSyncTrigger.answered);
      await Future.wait([first, second]);
      await gate.future;

      expect(uploader.batches, hasLength(1));
    });

    test('a disposed controller publishes nothing further', () async {
      final controller = build();
      await store.record(record(1));

      controller.dispose();
      controller.dispose();

      expect(controller.state.value.phase, TriviaSyncPhase.disposed);
    });
  });
}
