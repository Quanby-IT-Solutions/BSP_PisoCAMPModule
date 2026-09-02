import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/presentation/providers/bundle_provider.dart';

import 'bundle_test_support.dart';

void main() {
  test(
    'provider bootstraps seed, publishes replacement, and pins old holder',
    () async {
      final root = await Directory.systemTemp.createTemp('ce1-provider-');
      final server = await LoopbackBundleServer.start();
      addTearDown(() async {
        await server.close();
        if (await root.exists()) await root.delete(recursive: true);
      });
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.provider',
            bytes: Uint8List.fromList(utf8.encode('{"provider":true}')),
          ),
        ],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..manifestEtag = '"${update.envelope.payloadSha256}"'
        ..resources.addAll(update.resources);
      final container = ProviderContainer(
        overrides: [
          bundleDocumentsRootProvider.overrideWith((ref) async => root),
          bundleAssetLoaderProvider.overrideWithValue(loadSeedAsset),
          bundleVersionedUrlProvider.overrideWithValue(server.versionedUrl),
          bundleNetworkKeyRingProvider.overrideWithValue(update.keyRing),
        ],
      );
      addTearDown(container.dispose);
      final seen = <ActiveCurrencyCatalog>[];
      final subscription = container.listen(activeCurrencyCatalogProvider, (
        _,
        next,
      ) {
        final value = next.value;
        if (value != null) seen.add(value);
      }, fireImmediately: true);
      addTearDown(subscription.close);

      final old = await container.read(activeCurrencyCatalogProvider.future);
      expect(old.version, '0');
      final controller = await container.read(
        bundleSyncControllerProvider.future,
      );
      await controller.sync(BundleSyncTrigger.manual);
      await pumpEventQueue();

      expect(
        seen.map((catalog) => catalog.version),
        containsAllInOrder(['0', '1']),
      );
      expect(old.version, '0');
      expect(old.entries, hasLength(32));
      expect(seen.last.version, '1');
      expect(seen.last.entries.single.logicalId, 'content.provider');
    },
  );

  test(
    'provider disposal cancels delayed sync and closes its public client',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'ce1-provider-dispose-',
      );
      final server = await LoopbackBundleServer.start();
      addTearDown(() async {
        await server.close();
        if (await root.exists()) await root.delete(recursive: true);
      });
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.delayed',
            bytes: Uint8List.fromList(utf8.encode('{"delayed":true}')),
          ),
        ],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources)
        ..resourceDelay = const Duration(seconds: 2);
      final container = ProviderContainer(
        overrides: [
          bundleDocumentsRootProvider.overrideWith((ref) async => root),
          bundleAssetLoaderProvider.overrideWithValue(loadSeedAsset),
          bundleVersionedUrlProvider.overrideWithValue(server.versionedUrl),
          bundleNetworkKeyRingProvider.overrideWithValue(update.keyRing),
        ],
      );
      final controller = await container.read(
        bundleSyncControllerProvider.future,
      );
      final client = container.read(bundleClientProvider);
      final operation = controller.sync(BundleSyncTrigger.manual);
      while (!server.requests.any(
        (request) => request.path.contains('/resources/'),
      )) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }

      container.dispose();
      await operation.timeout(const Duration(seconds: 1));

      expect(client.isClosed, isTrue);
      expect(
        controller.state.phase,
        BundleSyncPhase.paused,
        reason: controller.state.toString(),
      );
      expect(controller.state.code, 'cancelled');
      expect(
        (await BundleStore(
          documentsRoot: root,
          loadAsset: loadSeedAsset,
          networkKeyRing: update.keyRing,
          versionedUrl: server.versionedUrl,
        ).readActive()).version,
        '0',
      );
    },
  );

  test(
    'concurrent activation during paused initial read still publishes newest catalog',
    () async {
      final root = await Directory.systemTemp.createTemp('ce1-provider-race-');
      final server = await LoopbackBundleServer.start();
      addTearDown(() async {
        await server.close();
        if (await root.exists()) await root.delete(recursive: true);
      });
      final update = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.race',
            bytes: Uint8List.fromList(utf8.encode('{"race":true}')),
          ),
        ],
      );
      server
        ..manifestBytes = update.envelopeBytes
        ..resources.addAll(update.resources);
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: server.versionedUrl,
      );
      await store.bootstrap();
      final snapshotCaptured = Completer<void>();
      final releaseSnapshot = Completer<void>();
      late ActiveCurrencyCatalog pinnedOld;
      final container = ProviderContainer(
        overrides: [
          bundleStoreProvider.overrideWith((ref) async => store),
          bundleAssetLoaderProvider.overrideWithValue(loadSeedAsset),
          bundleVersionedUrlProvider.overrideWithValue(server.versionedUrl),
          bundleNetworkKeyRingProvider.overrideWithValue(update.keyRing),
          activeCurrencyCatalogReadProvider.overrideWith((ref) async {
            return () async {
              pinnedOld = await store.readActive();
              snapshotCaptured.complete();
              await releaseSnapshot.future;
              return pinnedOld;
            };
          }),
        ],
      );
      addTearDown(container.dispose);
      final versionOnePublished = Completer<ActiveCurrencyCatalog>();
      final seen = <ActiveCurrencyCatalog>[];
      final subscription = container.listen(activeCurrencyCatalogProvider, (
        _,
        next,
      ) {
        final value = next.value;
        if (value == null) return;
        seen.add(value);
        if (value.version == '1' && !versionOnePublished.isCompleted) {
          versionOnePublished.complete(value);
        }
      }, fireImmediately: true);
      addTearDown(subscription.close);

      await snapshotCaptured.future.timeout(const Duration(seconds: 2));
      final controller = await container.read(
        bundleSyncControllerProvider.future,
      );
      await controller.sync(BundleSyncTrigger.startup);
      expect((await store.readActive()).version, '1');
      releaseSnapshot.complete();
      final newest = await versionOnePublished.future.timeout(
        const Duration(seconds: 2),
      );

      expect(seen.map((catalog) => catalog.version), ['0', '1']);
      expect(newest.version, '1');
      expect(newest.entries.single.logicalId, 'content.race');
      expect(pinnedOld.version, '0');
      expect(pinnedOld.entries, hasLength(32));
      expect(await pinnedOld.readBytes(pinnedOld.entries.first), isNotEmpty);
    },
  );

  test(
    'queued v1 and v2 never regress a delayed initial v2 snapshot',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'ce1-provider-monotonic-',
      );
      final server = await LoopbackBundleServer.start();
      addTearDown(() async {
        await server.close();
        if (await root.exists()) await root.delete(recursive: true);
      });
      final versionOne = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.monotonic-one',
            bytes: Uint8List.fromList(utf8.encode('{"version":1}')),
          ),
        ],
      );
      final versionTwo = await TestSignedBundle.create(
        version: '2',
        resources: [
          TestBundleResource(
            logicalId: 'content.monotonic-two',
            bytes: Uint8List.fromList(utf8.encode('{"version":2}')),
          ),
        ],
      );
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: versionOne.keyRing,
        versionedUrl: server.versionedUrl,
      );
      await store.bootstrap();
      final readStarted = Completer<void>();
      final releaseRead = Completer<void>();
      final container = ProviderContainer(
        overrides: [
          bundleStoreProvider.overrideWith((ref) async => store),
          bundleAssetLoaderProvider.overrideWithValue(loadSeedAsset),
          bundleVersionedUrlProvider.overrideWithValue(server.versionedUrl),
          bundleNetworkKeyRingProvider.overrideWithValue(versionOne.keyRing),
          activeCurrencyCatalogReadProvider.overrideWith((ref) async {
            return () async {
              readStarted.complete();
              await releaseRead.future;
              return store.readActive();
            };
          }),
        ],
      );
      addTearDown(container.dispose);
      final seen = <ActiveCurrencyCatalog>[];
      final subscription = container.listen(activeCurrencyCatalogProvider, (
        _,
        next,
      ) {
        final value = next.value;
        if (value != null) seen.add(value);
      }, fireImmediately: true);
      addTearDown(subscription.close);

      await readStarted.future.timeout(const Duration(seconds: 2));
      final controller = await container.read(
        bundleSyncControllerProvider.future,
      );
      server
        ..manifestBytes = versionOne.envelopeBytes
        ..resources.addAll(versionOne.resources);
      await controller.sync(BundleSyncTrigger.connectivity);
      final pinnedVersionOne = await store.readActive();
      server
        ..manifestBytes = versionTwo.envelopeBytes
        ..resources.addAll(versionTwo.resources);
      await controller.sync(BundleSyncTrigger.connectivity);
      expect((await store.readActive()).version, '2');
      releaseRead.complete();
      await container.read(activeCurrencyCatalogProvider.future);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(seen.map((catalog) => catalog.version), ['2']);
      expect(pinnedVersionOne.version, '1');
      expect(
        await pinnedVersionOne.readBytes(pinnedVersionOne.entries.single),
        isNotEmpty,
      );
    },
  );

  test('catalog publication reconciliation uses canonical BigInt ordering', () {
    const reconciler = ActiveCatalogPublicationReconciler();

    expect(
      reconciler.shouldPublish(
        lastVersion: '9',
        lastManifestDigest: 'digest-nine',
        candidateVersion: '10',
        candidateManifestDigest: 'digest-ten',
      ),
      isTrue,
    );
    expect(
      reconciler.shouldPublish(
        lastVersion: '10',
        lastManifestDigest: 'digest-ten',
        candidateVersion: '9',
        candidateManifestDigest: 'digest-nine',
      ),
      isFalse,
    );
  });

  test('catalog publication reconciliation dedupes or fails closed', () {
    const reconciler = ActiveCatalogPublicationReconciler();

    expect(
      reconciler.shouldPublish(
        lastVersion: '10',
        lastManifestDigest: 'same-private-digest',
        candidateVersion: '10',
        candidateManifestDigest: 'same-private-digest',
      ),
      isFalse,
    );

    Object? conflict;
    try {
      reconciler.shouldPublish(
        lastVersion: '10',
        lastManifestDigest: 'first-private-digest',
        candidateVersion: '10',
        candidateManifestDigest: 'second-private-digest',
      );
    } catch (error) {
      conflict = error;
    }
    expect(conflict, isA<BundleStoreException>());
    expect(
      (conflict! as BundleStoreException).code,
      'active_catalog_invariant_failed',
    );
    expect(conflict.toString(), isNot(contains('first-private-digest')));
    expect(conflict.toString(), isNot(contains('second-private-digest')));
  });
}
