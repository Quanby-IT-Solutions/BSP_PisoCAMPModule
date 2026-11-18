import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';

import 'bundle_test_support.dart';

void main() {
  late Directory root;
  late LoopbackBundleServer server;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce1-review-fix-');
    server = await LoopbackBundleServer.start();
  });

  tearDown(() async {
    await server.close();
    if (await root.exists()) await root.delete(recursive: true);
  });

  BundleClient client({int attempts = 3, Duration? backoff}) => BundleClient(
    dio: Dio(),
    versionedUrl: server.versionedUrl,
    retryPolicy: BundleRetryPolicy(
      maximumAttempts: attempts,
      initialBackoff: backoff ?? const Duration(milliseconds: 5),
      maximumConcurrency: 2,
    ),
  );

  Future<BundleStore> store(TestSignedBundle bundle) async {
    final value = BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: bundle.keyRing,
      versionedUrl: server.versionedUrl,
    );
    await value.bootstrap();
    return value;
  }

  Future<void> writePartial(
    TestSignedBundle bundle,
    TestBundleResource resource, {
    required int length,
    Uri? url,
  }) async {
    final downloads = Directory(
      '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}${bundle.version}${Platform.pathSeparator}downloads',
    );
    await downloads.create(recursive: true);
    await File(
      '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
    ).writeAsBytes(resource.bytes.sublist(0, length), flush: true);
    await File(
      '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
    ).writeAsString(
      jsonEncode({
        'schemaVersion': 1,
        'url': (url ?? server.versionedUrl)
            .replace(
              path:
                  '${(url ?? server.versionedUrl).path}/pisocamp/bundle/resources/${resource.digest}',
            )
            .toString(),
        'expectedDigest': resource.digest,
        'expectedLength': resource.bytes.length,
        'downloadedLength': length,
        'etag': '"${resource.digest}"',
      }),
      flush: true,
    );
  }

  test(
    'review lifecycle interfaces expose catalog publication and cleanup',
    () async {
      final client = BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl,
      );
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: BundleKeyRing.packagedSeed(),
        versionedUrl: server.versionedUrl,
      );
      await store.bootstrap();
      final controller = BundleSyncController(
        store: store,
        client: client,
        networkKeyRing: BundleKeyRing.packagedSeed(),
      );

      expect(controller.activeCatalogs, isA<Stream<ActiveCurrencyCatalog>>());
      await controller.dispose();
      client.close();
      expect(client.isClosed, isTrue);
    },
  );

  test('transient resource open retries with bounded backoff', () async {
    final resource = TestBundleResource(
      logicalId: 'content.retry-open',
      bytes: Uint8List.fromList(utf8.encode('{"retry":true}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..resources.addAll(update.resources)
      ..resourceTransientFailures[resource.digest] = 1;
    final value = await store(update);
    final controller = BundleSyncController(
      store: value,
      client: client(backoff: const Duration(milliseconds: 30)),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);
    final watch = Stopwatch()..start();

    await controller.sync(BundleSyncTrigger.manual);

    expect(controller.state.phase, BundleSyncPhase.active);
    expect(
      watch.elapsed,
      greaterThanOrEqualTo(const Duration(milliseconds: 20)),
    );
    expect(
      server.requests.where((r) => r.path.contains('/resources/')),
      hasLength(2),
    );
  });

  test(
    'resource retry exhaustion stops at maximum attempts and backs off',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.retry-exhausted',
        bytes: Uint8List.fromList(utf8.encode('{"retry":"exhausted"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources)
        ..resourceTransientFailures[resource.digest] = 10;
      final value = await store(update);
      final controller = BundleSyncController(
        store: value,
        client: client(attempts: 3, backoff: const Duration(milliseconds: 30)),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);
      final watch = Stopwatch()..start();

      await controller.sync(BundleSyncTrigger.manual);

      expect(controller.state.phase, BundleSyncPhase.paused);
      expect(
        server.requests.where((r) => r.path.contains('/resources/')),
        hasLength(3),
      );
      expect(
        watch.elapsed,
        greaterThanOrEqualTo(const Duration(milliseconds: 70)),
      );
      expect((await value.readActive()).version, '0');
    },
  );

  test('completed-operation cancellation links can be explicitly unlinked', () {
    final source = BundleCancellationToken();
    final completedOperation = BundleCancellationToken();
    final link = BundleCancellationLink(source, completedOperation);

    link.unlink();
    source.cancel();

    expect(completedOperation.isCancelled, isFalse);
  });

  test(
    'mid-stream failure retries by resuming the persisted partial',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.retry-stream',
        bytes: Uint8List.fromList(utf8.encode('{"pad":"${'x' * 8192}"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources)
        ..behaviors[resource.digest] = RangeBehavior.disconnectOnce;
      final value = await store(update);
      final controller = BundleSyncController(
        store: value,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(BundleSyncTrigger.manual);

      final requests = server.requests
          .where((r) => r.path.contains('/resources/'))
          .toList();
      expect(controller.state.phase, BundleSyncPhase.active);
      expect(requests, hasLength(2));
      expect(requests.last.headers['range'], startsWith('bytes='));
      expect(requests.last.headers['if-range'], '"${resource.digest}"');
    },
  );

  test('cancellation interrupts resource retry backoff promptly', () async {
    final resource = TestBundleResource(
      logicalId: 'content.cancel-backoff',
      bytes: Uint8List.fromList(utf8.encode('{"cancel":true}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..resources.addAll(update.resources)
      ..resourceTransientFailures[resource.digest] = 10;
    final cancellation = BundleCancellationToken();
    final controller = BundleSyncController(
      store: await store(update),
      client: client(backoff: const Duration(seconds: 2)),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);
    final operation = controller.sync(
      BundleSyncTrigger.manual,
      cancellation: cancellation,
    );
    while (!server.requests.any((r) => r.path.contains('/resources/'))) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    final watch = Stopwatch()..start();
    cancellation.cancel();
    await operation;

    expect(watch.elapsed, lessThan(const Duration(seconds: 1)));
    expect(
      controller.state.phase,
      BundleSyncPhase.paused,
      reason: controller.state.toString(),
    );
    expect(
      server.requests.where((r) => r.path.contains('/resources/')),
      hasLength(1),
    );
  });

  test('mid-stream cancellation retains only a safe resumable partial', () async {
    final resource = TestBundleResource(
      logicalId: 'content.cancel-stream',
      bytes: Uint8List.fromList(utf8.encode('{"pad":"${'c' * 8192}"}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..resources.addAll(update.resources)
      ..behaviors[resource.digest] = RangeBehavior.slowChunks;
    final value = await store(update);
    final cancellation = BundleCancellationToken();
    final controller = BundleSyncController(
      store: value,
      client: client(),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);
    final operation = controller.sync(
      BundleSyncTrigger.manual,
      cancellation: cancellation,
    );
    final downloads = Directory(
      '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1${Platform.pathSeparator}downloads',
    );
    final part = File(
      '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
    );
    while (!await part.exists() || await part.length() == 0) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    final cancellationWatch = Stopwatch()..start();
    cancellation.cancel();
    await operation;

    expect(cancellationWatch.elapsed, lessThan(const Duration(seconds: 1)));
    expect(controller.state.phase, BundleSyncPhase.paused);
    final journal = File(
      '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
    );
    final partExists = await part.exists();
    final journalExists = await journal.exists();
    expect(
      partExists == journalExists,
      isTrue,
      reason: 'cancellation must retain a valid pair or remove both files',
    );
    if (partExists) {
      final partLength = await part.length();
      expect(partLength, greaterThan(0));
      expect(partLength, lessThan(resource.bytes.length));
      final resume = jsonDecode(await journal.readAsString());
      expect(resume, isA<Map<String, Object?>>());
      expect((resume as Map<String, Object?>)['downloadedLength'], partLength);
      await value.recover();
      expect(await part.exists(), isTrue, reason: 'retained pair must recover');
      expect(
        await journal.exists(),
        isTrue,
        reason: 'retained pair must recover',
      );
    }
    expect((await value.readActive()).version, '0');
  });

  test(
    'pre-journal cancellation leaves a valid pair or removes both files',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.cancel-before-journal',
        bytes: Uint8List.fromList(utf8.encode('{"pad":"${'p' * 512}"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources);
      final downloads = Directory(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1${Platform.pathSeparator}downloads',
      );
      final part = File(
        '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
      );
      final journal = File(
        '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
      );
      final cancellation = BundleCancellationToken();
      RandomAccessFile? heldPartHandle;
      final deleteAttempts = <int>[];
      final value = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
        faults: BundleStoreFaults(
          beforeResumeJournalWrite: () {
            cancellation.cancel();
            heldPartHandle = part.openSync(mode: FileMode.append);
            throw const FileSystemException('cancelled before journal write');
          },
          afterEntityDeleteFailure: (attempt) {
            deleteAttempts.add(attempt);
            if (attempt == 1) {
              heldPartHandle?.closeSync();
              heldPartHandle = null;
            }
          },
        ),
      );
      await value.bootstrap();
      final controller = BundleSyncController(
        store: value,
        client: client(attempts: 1),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      try {
        await controller.sync(
          BundleSyncTrigger.manual,
          cancellation: cancellation,
        );

        final partExists = await part.exists();
        final journalExists = await journal.exists();
        expect(controller.state.phase, BundleSyncPhase.paused);
        expect(deleteAttempts, [1]);
        expect(
          partExists == journalExists,
          isTrue,
          reason: 'cleanup must publish a valid pair or remove both files',
        );
      } finally {
        await heldPartHandle?.close();
      }
    },
    // Windows-only: both cases make cleanup fail by holding an open handle
    // on the .part file. Windows refuses to unlink an open file, which is
    // what drives the delete-retry path under test. POSIX unlinks it
    // happily, so the failure never occurs, `afterEntityDeleteFailure`
    // never fires, and the expectation can never be met on macOS or Linux.
    skip: !Platform.isWindows,
  );

  test(
    'persistent pre-journal lock exhausts once and recovery removes orphan',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.cancel-cleanup-exhausted',
        bytes: Uint8List.fromList(utf8.encode('{"pad":"${'x' * 512}"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources);
      final stage = Directory(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1',
      );
      final downloads = Directory(
        '${stage.path}${Platform.pathSeparator}downloads',
      );
      final part = File(
        '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
      );
      final journal = File(
        '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
      );
      final cancellation = BundleCancellationToken();
      final deleteAttempts = <int>[];
      RandomAccessFile? heldPartHandle;
      final value = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
        faults: BundleStoreFaults(
          beforeResumeJournalWrite: () {
            cancellation.cancel();
            heldPartHandle = part.openSync(mode: FileMode.append);
            throw const FileSystemException('cancelled before journal write');
          },
          afterEntityDeleteFailure: (attempt) {
            deleteAttempts.add(attempt);
            throw StateError('notification failures must stay contained');
          },
        ),
      );
      await value.bootstrap();
      final controller = BundleSyncController(
        store: value,
        client: client(attempts: 1),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(
        BundleSyncTrigger.manual,
        cancellation: cancellation,
      );

      try {
        expect(deleteAttempts, [1, 2, 3, 4]);
        expect(controller.state.phase, BundleSyncPhase.failed);
        expect(controller.state.code, 'partial_cleanup_failed');
        expect(await part.exists(), isTrue);
        expect(await journal.exists(), isFalse);
        expect((await value.readActive()).version, '0');
      } finally {
        await heldPartHandle?.close();
        heldPartHandle = null;
      }

      expect((await value.recover()).version, '0');
      expect(await stage.exists(), isFalse);
      expect(await part.exists(), isFalse);
      expect(await journal.exists(), isFalse);
    },
    // Windows-only: both cases make cleanup fail by holding an open handle
    // on the .part file. Windows refuses to unlink an open file, which is
    // what drives the delete-retry path under test. POSIX unlinks it
    // happily, so the failure never occurs, `afterEntityDeleteFailure`
    // never fires, and the expectation can never be met on macOS or Linux.
    skip: !Platform.isWindows,
  );

  test(
    'rejected resume is cancelled and fallback 200 MIME is validated',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.fallback-mime',
        bytes: Uint8List.fromList(utf8.encode('{"pad":"${'m' * 512}"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources)
        ..behaviors[resource.digest] = RangeBehavior.fallbackWrongMime;
      final value = await store(update);
      await writePartial(update, resource, length: resource.bytes.length ~/ 2);
      final controller = BundleSyncController(
        store: value,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(BundleSyncTrigger.manual);

      expect(controller.state.code, 'resource_mime_mismatch');
      expect(
        server.requests.where((r) => r.path.contains('/resources/')),
        hasLength(2),
      );
      expect(server.maximumActiveResourceRequests, 1);
      expect((await value.readActive()).version, '0');
    },
  );

  test(
    'server observes rejected response cancellation before fallback',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.held-rejected',
        bytes: Uint8List.fromList(utf8.encode('{"pad":"${'h' * 512}"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources)
        ..behaviors[resource.digest] = RangeBehavior.heldRejected;
      final value = await store(update);
      await writePartial(update, resource, length: resource.bytes.length ~/ 2);
      final controller = BundleSyncController(
        store: value,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(BundleSyncTrigger.manual);

      expect(controller.state.phase, BundleSyncPhase.active);
      expect(server.rejectedResponseCancelled.isCompleted, isTrue);
      expect(server.fallbackObservedAfterCancellation, isTrue);
      expect(
        server.requests.where((r) => r.path.contains('/resources/')),
        hasLength(2),
      );
      expect(server.maximumActiveResourceRequests, 1);
    },
  );

  test('416 requires exact signed unsatisfied Content-Range total', () async {
    final resource = TestBundleResource(
      logicalId: 'content.bad-416',
      bytes: Uint8List.fromList(utf8.encode('{"complete":true}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..resources.addAll(update.resources)
      ..behaviors[resource.digest] = RangeBehavior.malformed416;
    final value = await store(update);
    await writePartial(update, resource, length: resource.bytes.length);
    final controller = BundleSyncController(
      store: value,
      client: client(),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);

    await controller.sync(BundleSyncTrigger.manual);

    expect(controller.state.code, 'range_not_satisfiable');
    expect((await value.readActive()).version, '0');
  });

  test('store rejects client origin mismatch before transport', () async {
    final resource = TestBundleResource(
      logicalId: 'content.origin',
      bytes: Uint8List.fromList(utf8.encode('{"origin":true}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    final value = BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: update.keyRing,
      versionedUrl: Uri.parse('https://example.test/api/v1'),
    );
    await value.bootstrap();

    await expectLater(
      value.stage(
        envelope: update.envelope,
        envelopeBytes: update.envelopeBytes,
        client: client(),
      ),
      throwsA(
        isA<BundleStoreException>().having(
          (e) => e.code,
          'code',
          'bundle_origin_mismatch',
        ),
      ),
    );
    expect(server.requests, isEmpty);
  });

  test(
    'recovery deletes a journal from a different scheme host or port',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.cross-origin-journal',
        bytes: Uint8List.fromList(utf8.encode('{"journal":true}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      final value = await store(update);
      final stage = Directory(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1',
      );
      for (final wrongOrigin in [
        server.versionedUrl.replace(scheme: 'https'),
        server.versionedUrl.replace(host: 'localhost'),
        server.versionedUrl.replace(port: server.versionedUrl.port + 1),
      ]) {
        await writePartial(update, resource, length: 1, url: wrongOrigin);
        await File(
          '${stage.path}${Platform.pathSeparator}manifest.envelope.json',
        ).writeAsBytes(update.envelopeBytes, flush: true);

        await value.recover();

        expect(await stage.exists(), isFalse, reason: '$wrongOrigin');
      }
    },
  );

  test('client rejects unsafe origins and resource redirects', () async {
    for (final unsafe in [
      Uri.parse('ftp://example.test/api/v1'),
      Uri.parse('https://user@example.test/api/v1'),
      Uri.parse('https://example.test/api/v1?token=secret'),
    ]) {
      expect(
        () => BundleClient(dio: Dio(), versionedUrl: unsafe),
        throwsA(isA<BundleClientException>()),
      );
    }
    final resource = TestBundleResource(
      logicalId: 'content.redirect',
      bytes: Uint8List.fromList(utf8.encode('{"redirect":true}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..resources.addAll(update.resources)
      ..behaviors[resource.digest] = RangeBehavior.redirect;
    final value = await store(update);
    final controller = BundleSyncController(
      store: value,
      client: client(),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);

    await controller.sync(BundleSyncTrigger.manual);

    expect(controller.state.phase, BundleSyncPhase.failed);
    expect((await value.readActive()).version, '0');
    expect(
      server.requests.where((r) => r.path.contains('/resources/')),
      hasLength(1),
    );
  });

  test('manifest streaming rejects the byte limit without a retry', () async {
    server.manifestBytes = Uint8List(3000001);
    final value = client();

    await expectLater(
      value.fetchManifest(),
      throwsA(
        isA<BundleClientException>().having(
          (error) => error.code,
          'code',
          'manifest_response_invalid',
        ),
      ),
    );

    expect(server.requests, hasLength(1));
  });

  test(
    'resource overflow and underflow are permanent and preserve active',
    () async {
      var version = 1;
      for (final behavior in [
        RangeBehavior.overflow,
        RangeBehavior.truncated,
      ]) {
        final resource = TestBundleResource(
          logicalId: 'content.${behavior.name}',
          bytes: Uint8List.fromList(utf8.encode('{"bound":"$behavior"}')),
        );
        final update = await TestSignedBundle.create(
          version: '${version++}',
          resources: [resource],
        );
        server
          ..requests.clear()
          ..manifestBytes = update.envelopeBytes
          ..resources.addAll(update.resources)
          ..behaviors[resource.digest] = behavior;
        final value = await store(update);
        final controller = BundleSyncController(
          store: value,
          client: client(),
          networkKeyRing: update.keyRing,
        );
        await controller.sync(BundleSyncTrigger.manual);
        await controller.dispose();

        expect(
          controller.state.phase,
          BundleSyncPhase.failed,
          reason: '$behavior',
        );
        expect(
          server.requests.where((r) => r.path.contains('/resources/')),
          hasLength(1),
          reason: 'permanent $behavior must not retry',
        );
        expect((await value.readActive()).version, '0');
        final downloads = Directory(
          '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}${update.version}${Platform.pathSeparator}downloads',
        );
        expect(
          await File(
            '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
          ).exists(),
          isFalse,
        );
        expect(
          await File(
            '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
          ).exists(),
          isFalse,
        );
      }
    },
  );

  test(
    'resume journal write failure discards an inconsistent partial pair',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.journal-write-failure',
        bytes: Uint8List.fromList(utf8.encode('{"pad":"${'j' * 512}"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources);
      final value = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
        faults: BundleStoreFaults(
          beforeResumeJournalWrite: () {
            throw const FileSystemException('journal write denied');
          },
        ),
      );
      await value.bootstrap();
      final controller = BundleSyncController(
        store: value,
        client: client(attempts: 1),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(BundleSyncTrigger.manual);

      final downloads = Directory(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1${Platform.pathSeparator}downloads',
      );
      expect(controller.state.phase, BundleSyncPhase.paused);
      expect(
        await File(
          '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
        ).exists(),
        isFalse,
      );
      expect(
        await File(
          '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
        ).exists(),
        isFalse,
      );
      expect((await value.readActive()).version, '0');
    },
  );

  test(
    'recovery removes journals with unknown keys types or invalid lengths',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.malformed-journal',
        bytes: Uint8List.fromList(utf8.encode('{"journal":"strict"}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      final cases = <Map<String, Object?>>[
        {'unknown': true},
        {'downloadedLength': '1'},
        {'downloadedLength': resource.bytes.length + 1},
      ];
      for (var index = 0; index < cases.length; index++) {
        final caseRoot = await Directory.systemTemp.createTemp(
          'ce1-malformed-journal-$index-',
        );
        addTearDown(() async {
          if (await caseRoot.exists()) await caseRoot.delete(recursive: true);
        });
        final value = BundleStore(
          documentsRoot: caseRoot,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
        );
        await value.bootstrap();
        final stage = Directory(
          '${caseRoot.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1',
        );
        final downloads = Directory(
          '${stage.path}${Platform.pathSeparator}downloads',
        );
        await downloads.create(recursive: true);
        await File(
          '${stage.path}${Platform.pathSeparator}manifest.envelope.json',
        ).writeAsBytes(update.envelopeBytes, flush: true);
        await File(
          '${downloads.path}${Platform.pathSeparator}${resource.digest}.part',
        ).writeAsBytes(resource.bytes.sublist(0, 1), flush: true);
        final journal = <String, Object?>{
          'schemaVersion': 1,
          'url':
              '${server.versionedUrl}/pisocamp/bundle/resources/${resource.digest}',
          'expectedDigest': resource.digest,
          'expectedLength': resource.bytes.length,
          'downloadedLength': 1,
          'etag': '"${resource.digest}"',
          ...cases[index],
        };
        await File(
          '${downloads.path}${Platform.pathSeparator}${resource.digest}.resume.json',
        ).writeAsString(jsonEncode(journal), flush: true);

        await value.recover();

        expect(await stage.exists(), isFalse, reason: 'case $index');
      }
    },
  );

  test('signed resources still reject invalid JSON and PNG magic', () async {
    var version = 1;
    for (final resource in [
      TestBundleResource(
        logicalId: 'content.invalid-json',
        bytes: Uint8List.fromList(utf8.encode('not-json')),
      ),
      TestBundleResource(
        logicalId: 'image.invalid-png',
        kind: BundleEntryKind.image,
        mediaType: 'image/png',
        bytes: Uint8List.fromList(const [0, 1, 2, 3]),
      ),
    ]) {
      final update = await TestSignedBundle.create(
        version: '${version++}',
        resources: [resource],
      );
      server
        ..requests.clear()
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources);
      if (resource.mediaType == 'image/png') {
        server.resourceContentTypes[resource.digest] = ContentType(
          'image',
          'png',
        );
      }
      final value = await store(update);
      final controller = BundleSyncController(
        store: value,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      await controller.sync(BundleSyncTrigger.manual);
      await controller.dispose();

      expect(controller.state.code, 'resource_verification_failed');
      expect(
        server.requests.where((r) => r.path.contains('/resources/')),
        hasLength(1),
      );
      expect((await value.readActive()).version, '0');
    }
  });

  test(
    'corrupted signature is rejected before resource transport and stays private',
    () async {
      final resource = TestBundleResource(
        logicalId: 'content.signature',
        bytes: Uint8List.fromList(utf8.encode('{"signature":true}')),
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      final envelope =
          jsonDecode(utf8.decode(update.envelopeBytes)) as Map<String, dynamic>;
      final signature = envelope['signature'] as String;
      envelope['signature'] =
          '${signature.startsWith('A') ? 'B' : 'A'}${signature.substring(1)}';
      server
        ..manifestBytes = Uint8List.fromList(utf8.encode(jsonEncode(envelope)))
        ..resources.addAll(update.resources);
      final value = await store(update);
      final controller = BundleSyncController(
        store: value,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(BundleSyncTrigger.manual);

      expect(controller.state.code, 'manifest_verification_failed');
      expect(controller.state.toString(), isNot(contains(signature)));
      expect(
        server.requests.where((r) => r.path.contains('/resources/')),
        isEmpty,
      );
      expect((await value.readActive()).version, '0');
    },
  );

  test(
    'strict pointer and high-water objects reject unknown keys and repair',
    () async {
      final value = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: BundleKeyRing.packagedSeed(),
        versionedUrl: server.versionedUrl,
      );
      final initial = await value.bootstrap();
      final bundleRoot =
          '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles';
      await File(
        '$bundleRoot${Platform.pathSeparator}active.json',
      ).writeAsString(
        jsonEncode({
          'schemaVersion': 1,
          'bundleVersion': '0',
          'manifestDigest': initial.manifestDigest,
          'unknown': true,
        }),
        flush: true,
      );
      await File(
        '$bundleRoot${Platform.pathSeparator}high-water.json',
      ).writeAsString(
        jsonEncode({
          'schemaVersion': 1,
          'bundleVersion': '0',
          'manifestDigest': initial.manifestDigest,
          'unknown': true,
        }),
        flush: true,
      );

      final recovered = await value.recover();

      expect(recovered.version, '0');
      for (final name in ['active.json', 'high-water.json']) {
        final decoded =
            jsonDecode(
                  await File(
                    '$bundleRoot${Platform.pathSeparator}$name',
                  ).readAsString(),
                )
                as Map<String, dynamic>;
        expect(decoded.keys.toSet(), {
          'schemaVersion',
          'bundleVersion',
          'manifestDigest',
        });
      }
    },
  );

  test('packaged seed index rejects unregistered traversal entries', () async {
    Future<Uint8List> maliciousLoader(String assetPath) async {
      if (assetPath.endsWith('resource-index.json')) {
        return Uint8List.fromList(
          utf8.encode(jsonEncode({List.filled(64, '0').join(): '../outside'})),
        );
      }
      return loadSeedAsset(assetPath);
    }

    final value = BundleStore(
      documentsRoot: root,
      loadAsset: maliciousLoader,
      networkKeyRing: BundleKeyRing.packagedSeed(),
      versionedUrl: server.versionedUrl,
    );

    await expectLater(
      value.bootstrap(),
      throwsA(
        isA<BundleStoreException>().having(
          (error) => error.code,
          'code',
          'seed_index_invalid',
        ),
      ),
    );
  });

  test(
    'recovery ignores invalid ready state and selects newest verified bundle',
    () async {
      final oneResource = TestBundleResource(
        logicalId: 'content.ready-one',
        bytes: Uint8List.fromList(utf8.encode('{"ready":1}')),
      );
      final twoResource = TestBundleResource(
        logicalId: 'content.ready-two',
        bytes: Uint8List.fromList(utf8.encode('{"ready":2}')),
      );
      final one = await TestSignedBundle.create(
        version: '1',
        resources: [oneResource],
      );
      final two = await TestSignedBundle.create(
        version: '2',
        resources: [twoResource],
      );
      final value = await store(one);
      for (final update in [one, two]) {
        server.resources.addAll(update.resources);
        final staged = await value.stage(
          envelope: update.envelope,
          envelopeBytes: update.envelopeBytes,
          client: client(),
        );
        await value.activate(staged);
      }
      final bundleRoot =
          '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles';
      await File('$bundleRoot${Platform.pathSeparator}active.json').delete();
      await File(
        '$bundleRoot${Platform.pathSeparator}high-water.json',
      ).delete();
      final invalidReady = File(
        '$bundleRoot${Platform.pathSeparator}ready${Platform.pathSeparator}9${Platform.pathSeparator}manifest.envelope.json',
      );
      await invalidReady.parent.create(recursive: true);
      await invalidReady.writeAsString('{"invalid":true}', flush: true);

      final recovered = await value.recover();

      expect(recovered.version, '2');
      expect(recovered.entries.single.logicalId, 'content.ready-two');
    },
  );

  test('a post-version-two rollback is rejected before download', () async {
    final higherResource = TestBundleResource(
      logicalId: 'content.higher',
      bytes: Uint8List.fromList(utf8.encode('{"version":2}')),
    );
    final lowerResource = TestBundleResource(
      logicalId: 'content.lower',
      bytes: Uint8List.fromList(utf8.encode('{"version":1}')),
    );
    final higher = await TestSignedBundle.create(
      version: '2',
      resources: [higherResource],
    );
    final lower = await TestSignedBundle.create(
      version: '1',
      resources: [lowerResource],
    );
    server.resources.addAll(higher.resources);
    final value = await store(higher);
    final staged = await value.stage(
      envelope: higher.envelope,
      envelopeBytes: higher.envelopeBytes,
      client: client(),
    );
    await value.activate(staged);
    server.requests.clear();

    await expectLater(
      value.stage(
        envelope: lower.envelope,
        envelopeBytes: lower.envelopeBytes,
        client: client(),
      ),
      throwsA(
        isA<BundleStoreException>().having(
          (error) => error.code,
          'code',
          'bundle_version_rejected',
        ),
      ),
    );

    expect(server.requests, isEmpty);
    expect((await value.readActive()).version, '2');
  });
}
