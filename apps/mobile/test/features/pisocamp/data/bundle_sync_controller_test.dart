import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';

import 'bundle_test_support.dart';

void main() {
  late Directory root;
  late LoopbackBundleServer server;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce1-bundle-sync-');
    server = await LoopbackBundleServer.start();
  });

  tearDown(() async {
    await server.close();
    if (await root.exists()) await root.delete(recursive: true);
  });

  Future<BundleStore> bootstrappedStore(TestSignedBundle update) async {
    final store = BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: update.keyRing,
      versionedUrl: server.versionedUrl,
    );
    await store.bootstrap();
    return store;
  }

  BundleClient client({int maximumAttempts = 2, Duration? initialBackoff}) =>
      BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl,
        retryPolicy: BundleRetryPolicy(
          maximumAttempts: maximumAttempts,
          initialBackoff: initialBackoff ?? const Duration(milliseconds: 1),
          maximumConcurrency: 2,
        ),
      );

  test(
    'serializes triggers and publishes one active state without credentials',
    () async {
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.update',
            bytes: Uint8List.fromList(utf8.encode('{"version":1}')),
          ),
        ],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..manifestEtag = '"${update.envelope.payloadSha256}"'
        ..resources.addAll(update.resources);
      final controller = BundleSyncController(
        store: await bootstrappedStore(update),
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);
      final states = <BundleSyncPhase>[];
      final subscription = controller.states.listen(
        (state) => states.add(state.phase),
      );
      addTearDown(subscription.cancel);

      final first = controller.sync(BundleSyncTrigger.startup);
      final second = controller.sync(BundleSyncTrigger.connectivity);
      await Future.wait([first, second]);

      expect(
        server.requests.where((request) => request.path.endsWith('/manifest')),
        hasLength(1),
      );
      expect(
        states.where((phase) => phase == BundleSyncPhase.active),
        hasLength(1),
      );
      expect(controller.state.phase, BundleSyncPhase.active);
      for (final request in server.requests) {
        expect(request.headers, isNot(contains('cookie')));
        expect(request.headers, isNot(contains('authorization')));
        expect(request.headers, isNot(contains('origin')));
      }
    },
  );

  test(
    'strong manifest ETag allows a 304 no-op with no resource request',
    () async {
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.update',
            bytes: Uint8List.fromList(utf8.encode('{"version":1}')),
          ),
        ],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..manifestEtag = '"${update.envelope.payloadSha256}"'
        ..resources.addAll(update.resources);
      final store = await bootstrappedStore(update);
      final controller = BundleSyncController(
        store: store,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);
      await controller.sync(BundleSyncTrigger.manual);
      server
        ..requests.clear()
        ..manifestNotModified = true;

      await controller.sync(BundleSyncTrigger.manual);

      expect(controller.state.phase, BundleSyncPhase.active);
      expect(server.requests, hasLength(1));
      expect(
        server.requests.single.headers['if-none-match'],
        server.manifestEtag,
      );
      expect((await store.readActive()).version, '1');
    },
  );

  test(
    'disconnect persists a safe partial and a recreated controller resumes 206',
    () async {
      final bytes = Uint8List.fromList(
        utf8.encode('{"payload":"${'x' * 8192}"}'),
      );
      final resource = TestBundleResource(
        logicalId: 'content.large',
        bytes: bytes,
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..manifestEtag = '"${update.envelope.payloadSha256}"'
        ..resources.addAll(update.resources)
        ..behaviors[resource.digest] = RangeBehavior.disconnectOnce;
      final store = await bootstrappedStore(update);
      final firstController = BundleSyncController(
        store: store,
        client: client(maximumAttempts: 1),
        networkKeyRing: update.keyRing,
      );
      addTearDown(firstController.dispose);

      await firstController.sync(BundleSyncTrigger.manual);
      expect(firstController.state.phase, BundleSyncPhase.paused);
      expect((await store.readActive()).version, '0');
      final part = File(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1${Platform.pathSeparator}downloads${Platform.pathSeparator}${resource.digest}.part',
      );
      expect(await part.exists(), isTrue);
      expect(await part.length(), greaterThan(0));
      expect(await part.length(), lessThan(bytes.length));
      await BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
      ).recover();
      expect(await part.exists(), isTrue);

      final recreated = BundleSyncController(
        store: BundleStore(
          documentsRoot: root,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
        ),
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(recreated.dispose);
      await recreated.sync(BundleSyncTrigger.connectivity);

      expect(recreated.state.phase, BundleSyncPhase.active);
      expect((await store.readActive()).version, '1');
      final resourceRequests = server.requests
          .where((request) => request.path.contains('/resources/'))
          .toList();
      expect(resourceRequests.last.headers['range'], startsWith('bytes='));
      expect(resourceRequests.last.headers['if-range'], '"${resource.digest}"');
    },
  );

  test(
    'unexpected 200 and malformed Content-Range discard unsafe append and restart',
    () async {
      var version = 1;
      for (final behavior in [
        RangeBehavior.ignoreRange,
        RangeBehavior.changedEtag,
        RangeBehavior.weakEtag,
        RangeBehavior.malformedContentRange,
      ]) {
        server.requests.clear();
        final bytes = Uint8List.fromList(
          utf8.encode('{"case":"$behavior","pad":"${'z' * 512}"}'),
        );
        final resource = TestBundleResource(
          logicalId: 'content.${behavior.name.toLowerCase()}',
          bytes: bytes,
        );
        final update = await TestSignedBundle.create(
          version: (version++).toString(),
          resources: [resource],
        );
        server
          ..manifestBytes = update.envelopeBytes
          ..manifestEtag = '"${update.envelope.payloadSha256}"'
          ..resources.addAll(update.resources)
          ..behaviors[resource.digest] = behavior;
        final store = BundleStore(
          documentsRoot: root,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
        );
        if (!(await File(
          '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}active.json',
        ).exists())) {
          await store.bootstrap();
        }
        final staging = Directory(
          '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}${update.version}${Platform.pathSeparator}downloads',
        );
        await staging.create(recursive: true);
        final partialLength = bytes.length ~/ 2;
        await File(
          '${staging.path}${Platform.pathSeparator}${resource.digest}.part',
        ).writeAsBytes(bytes.sublist(0, partialLength), flush: true);
        await File(
          '${staging.path}${Platform.pathSeparator}${resource.digest}.resume.json',
        ).writeAsString(
          jsonEncode({
            'schemaVersion': 1,
            'url':
                '${server.versionedUrl}/pisocamp/bundle/resources/${resource.digest}',
            'expectedDigest': resource.digest,
            'expectedLength': bytes.length,
            'downloadedLength': partialLength,
            'etag': '"${resource.digest}"',
          }),
          flush: true,
        );
        final controller = BundleSyncController(
          store: store,
          client: client(),
          networkKeyRing: update.keyRing,
        );
        await controller.sync(BundleSyncTrigger.manual);
        await controller.dispose();

        expect(
          controller.state.phase,
          BundleSyncPhase.active,
          reason: '$behavior',
        );
        expect((await store.readActive()).version, update.version);
        expect(
          server.requests
              .where((request) => request.path.contains('/resources/'))
              .length,
          greaterThanOrEqualTo(1),
        );
      }
    },
  );

  test(
    'validated 416 completes an exact partial while an invalid 416 keeps old active',
    () async {
      final bytes = Uint8List.fromList(utf8.encode('{"complete":true}'));
      final resource = TestBundleResource(
        logicalId: 'content.complete',
        bytes: bytes,
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..manifestEtag = '"${update.envelope.payloadSha256}"'
        ..resources.addAll(update.resources)
        ..behaviors[resource.digest] = RangeBehavior.always416;
      final store = await bootstrappedStore(update);
      final staging = Directory(
        '${root.path}${Platform.pathSeparator}pisocamp${Platform.pathSeparator}bundles${Platform.pathSeparator}staging${Platform.pathSeparator}1${Platform.pathSeparator}downloads',
      );
      await staging.create(recursive: true);
      await File(
        '${staging.path}${Platform.pathSeparator}${resource.digest}.part',
      ).writeAsBytes(bytes, flush: true);
      await File(
        '${staging.path}${Platform.pathSeparator}${resource.digest}.resume.json',
      ).writeAsString(
        jsonEncode({
          'schemaVersion': 1,
          'url':
              '${server.versionedUrl}/pisocamp/bundle/resources/${resource.digest}',
          'expectedDigest': resource.digest,
          'expectedLength': bytes.length,
          'downloadedLength': bytes.length,
          'etag': '"${resource.digest}"',
        }),
        flush: true,
      );
      final controller = BundleSyncController(
        store: store,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);

      await controller.sync(BundleSyncTrigger.manual);
      expect(controller.state.phase, BundleSyncPhase.active);
      expect((await store.readActive()).version, '1');

      final invalidRoot = await Directory.systemTemp.createTemp(
        'ce1-invalid-416-',
      );
      addTearDown(() => invalidRoot.delete(recursive: true));
      final invalidStore = BundleStore(
        documentsRoot: invalidRoot,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
      );
      await invalidStore.bootstrap();
      final invalidController = BundleSyncController(
        store: invalidStore,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(invalidController.dispose);
      await invalidController.sync(BundleSyncTrigger.manual);
      expect(invalidController.state.phase, BundleSyncPhase.failed);
      expect((await invalidStore.readActive()).version, '0');
    },
  );

  test(
    'checksum, signature, redirect, cancellation, and disk failures stay private and preserve active',
    () async {
      final bytes = Uint8List.fromList(utf8.encode('{"safe":true}'));
      final resource = TestBundleResource(
        logicalId: 'content.safe',
        bytes: bytes,
      );
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [resource],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..manifestEtag = '"${update.envelope.payloadSha256}"'
        ..resources[resource.digest] = Uint8List.fromList(
          utf8.encode('{"evil":true}'),
        );
      final store = await bootstrappedStore(update);
      final controller = BundleSyncController(
        store: store,
        client: client(),
        networkKeyRing: update.keyRing,
      );
      addTearDown(controller.dispose);
      await controller.sync(BundleSyncTrigger.manual);
      expect(controller.state.phase, BundleSyncPhase.failed);
      expect(controller.state.code, 'resource_verification_failed');
      expect(controller.state.toString(), isNot(contains(root.path)));
      expect(controller.state.toString(), isNot(contains('evil')));
      expect((await store.readActive()).version, '0');

      final cancellation = BundleCancellationToken()..cancel();
      await controller.sync(
        BundleSyncTrigger.manual,
        cancellation: cancellation,
      );
      expect(controller.state.phase, BundleSyncPhase.paused);
      expect(controller.state.code, 'cancelled');

      server
        ..redirectManifest = true
        ..requests.clear();
      await controller.sync(BundleSyncTrigger.manual);
      expect(controller.state.phase, BundleSyncPhase.failed);
      expect(controller.state.code, 'manifest_transport_failed');
      expect(server.requests, hasLength(1));
    },
  );

  test('bounded retry and resource concurrency remain within policy', () async {
    final resources = [
      for (var index = 0; index < 5; index++)
        TestBundleResource(
          logicalId: 'content.concurrent-$index',
          bytes: Uint8List.fromList(utf8.encode('{"index":$index}')),
        ),
    ];
    final update = await TestSignedBundle.create(
      version: '1',
      resources: resources,
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..manifestEtag = '"${update.envelope.payloadSha256}"'
      ..manifestTransientFailures = 1
      ..resourceDelay = const Duration(milliseconds: 30)
      ..resources.addAll(update.resources);
    final controller = BundleSyncController(
      store: await bootstrappedStore(update),
      client: client(),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);

    await controller.sync(BundleSyncTrigger.manual);

    expect(controller.state.phase, BundleSyncPhase.active);
    expect(
      server.requests.where((request) => request.path.endsWith('/manifest')),
      hasLength(2),
    );
    expect(server.maximumActiveResourceRequests, 2);
  });

  test(
    'injected disk-full and permission denial preserve the prior active catalog',
    () async {
      for (final failure in <FileSystemException>[
        const FileSystemException('disk full'),
        const FileSystemException('permission denied'),
      ]) {
        final caseRoot = await Directory.systemTemp.createTemp(
          'ce1-storage-fault-',
        );
        addTearDown(() => caseRoot.delete(recursive: true));
        final update = await TestSignedBundle.create(
          version: '1',
          resources: [
            TestBundleResource(
              logicalId: 'content.storage-fault',
              bytes: Uint8List.fromList(utf8.encode('{"update":true}')),
            ),
          ],
        );
        server
          ..manifestBytes = update.envelopeBytes
          ..manifestEtag = '"${update.envelope.payloadSha256}"'
          ..resources.addAll(update.resources);
        final bootstrapStore = BundleStore(
          documentsRoot: caseRoot,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
        );
        await bootstrapStore.bootstrap();
        final faultedStore = BundleStore(
          documentsRoot: caseRoot,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
          faults: BundleStoreFaults(beforeObjectWrite: () => throw failure),
        );
        final controller = BundleSyncController(
          store: faultedStore,
          client: client(),
          networkKeyRing: update.keyRing,
        );
        await controller.sync(BundleSyncTrigger.manual);
        await controller.dispose();

        expect(controller.state.phase, BundleSyncPhase.failed);
        expect(controller.state.code, 'storage_failed');
        expect(controller.state.toString(), isNot(contains(caseRoot.path)));
        expect((await bootstrapStore.readActive()).version, '0');
      }
    },
  );

  test('rejects a resource MIME that differs from the signed entry', () async {
    final resource = TestBundleResource(
      logicalId: 'content.mime',
      bytes: Uint8List.fromList(utf8.encode('{"mime":true}')),
    );
    final update = await TestSignedBundle.create(
      version: '1',
      resources: [resource],
    );
    server
      ..manifestBytes = update.envelopeBytes
      ..manifestEtag = '"${update.envelope.payloadSha256}"'
      ..resources.addAll(update.resources)
      ..behaviors[resource.digest] = RangeBehavior.wrongMime;
    final store = await bootstrappedStore(update);
    final controller = BundleSyncController(
      store: store,
      client: client(),
      networkKeyRing: update.keyRing,
    );
    addTearDown(controller.dispose);

    await controller.sync(BundleSyncTrigger.manual);

    expect(controller.state.phase, BundleSyncPhase.failed);
    expect(controller.state.code, 'resource_mime_mismatch');
    expect((await store.readActive()).version, '0');
  });

  test('rejects injected interceptors and URL query data before transport', () {
    final credentialedDio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            options.headers['authorization'] = 'secret';
            handler.next(options);
          },
        ),
      );

    expect(
      () =>
          BundleClient(dio: credentialedDio, versionedUrl: server.versionedUrl),
      throwsA(
        isA<BundleClientException>().having(
          (error) => error.code,
          'code',
          'client_not_isolated',
        ),
      ),
    );
    expect(
      () => BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl.replace(query: 'token=secret'),
      ),
      throwsA(
        isA<BundleClientException>().having(
          (error) => error.code,
          'code',
          'invalid_bundle_origin',
        ),
      ),
    );
  });
}
