import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/bundle_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';

import '../data/bundle_test_support.dart';

void main() {
  test(
    'verified raster metadata accepts bounded PNG JPEG and WebP headers',
    () {
      final png = Uint8List.fromList([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        0,
        0,
        0,
        13,
        73,
        72,
        68,
        82,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
      ]);
      final jpeg = Uint8List.fromList([
        255,
        216,
        255,
        192,
        0,
        17,
        8,
        0,
        1,
        0,
        1,
        3,
        1,
        17,
        0,
        2,
        17,
        0,
        3,
        17,
        0,
      ]);
      final webp = Uint8List.fromList([
        82,
        73,
        70,
        70,
        22,
        0,
        0,
        0,
        87,
        69,
        66,
        80,
        86,
        80,
        56,
        88,
        10,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]);

      expect(VerifiedCurrencyImage.parse(png, 'image/png')?.width, 1);
      expect(VerifiedCurrencyImage.parse(jpeg, 'image/jpeg')?.height, 1);
      expect(VerifiedCurrencyImage.parse(webp, 'image/webp')?.width, 1);
      final tallPng = Uint8List.fromList([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        0,
        0,
        0,
        13,
        73,
        72,
        68,
        82,
        0,
        0,
        0,
        1,
        0,
        0,
        32,
        0,
      ]);
      final tall = VerifiedCurrencyImage.parse(tallPng, 'image/png')!;
      expect(tall.cacheWidth, lessThanOrEqualTo(1600));
      expect(tall.cacheHeight, lessThanOrEqualTo(1600));
    },
  );

  test('oversized raster dimensions are rejected before Image.memory', () {
    final oversizedPng = Uint8List.fromList([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      73,
      72,
      68,
      82,
      0,
      0,
      35,
      41,
      0,
      0,
      0,
      1,
    ]);

    expect(VerifiedCurrencyImage.parse(oversizedPng, 'image/png'), isNull);
  });

  test(
    'clean install exposes the complete ordered signed seed offline',
    () async {
      final root = await Directory.systemTemp.createTemp('ce1-ui-seed-');
      addTearDown(() async {
        if (await root.exists()) await root.delete(recursive: true);
      });
      final testKeys = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.test-key',
            bytes: Uint8List.fromList(utf8.encode('{"test":true}')),
          ),
        ],
      );
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: testKeys.keyRing,
        versionedUrl: Uri.parse(ApiConstants.versionedUrl),
      );

      final view = await CurrencyCatalogView.load(await store.bootstrap());

      expect(view.series, hasLength(5));
      expect(view.documents, hasLength(29));
      expect(view.documentsFor(CurrencyRouteKind.banknotes), hasLength(15));
      expect(view.documentsFor(CurrencyRouteKind.coins), hasLength(14));
      expect(view.series.map((series) => series.name), [
        'First Philippine Polymer Banknote Series',
        'Enhanced New Generation Currency Banknotes',
        'New Generation Currency Banknotes',
        'New Generation Currency Coin Series',
        'BSP Coin Series',
      ]);
      expect(
        view
            .documentsFor(CurrencyRouteKind.banknotes)
            .every((document) => document.kind == CurrencyContentKind.banknote),
        isTrue,
      );
      final first = view.documents.first;
      expect(
        view.resolveInternalRoute(
          '/pisocamp/currency/banknotes/${first.logicalId}',
        ),
        same(first),
      );
      expect(view.resolveInternalRoute('/profile'), isNull);
      expect(
        view.resolveInternalRoute(
          '/pisocamp/currency/banknotes/${first.logicalId}?leak=value',
        ),
        isNull,
      );
      final coin = view.documentsFor(CurrencyRouteKind.coins).first;
      final verifiedImage = await view.readImage(coin);
      expect(verifiedImage, isNotNull);
      expect((verifiedImage!.width, verifiedImage.height), (1536, 1024));
    },
  );

  test(
    'installed valid empty bundle opens the saved catalog while startup sync is offline',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'ce1-ui-installed-offline-',
      );
      final server = await LoopbackBundleServer.start();
      final update = await TestSignedBundle.create(
        version: '1',
        resources: const [],
      );
      final versionedUrl = server.versionedUrl;
      server.manifestBytes = update.envelopeBytes;
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: update.keyRing,
        versionedUrl: versionedUrl,
      );
      await store.bootstrap();
      final client = BundleClient(dio: Dio(), versionedUrl: versionedUrl);
      final staged = await store.stage(
        envelope: update.envelope,
        envelopeBytes: update.envelopeBytes,
        client: client,
      );
      await store.activate(staged);
      client.close();
      await server.close();
      addTearDown(() async {
        if (await root.exists()) await root.delete(recursive: true);
      });

      final container = ProviderContainer(
        overrides: [
          bundleDocumentsRootProvider.overrideWith((ref) async => root),
          bundleAssetLoaderProvider.overrideWithValue(loadSeedAsset),
          bundleVersionedUrlProvider.overrideWithValue(versionedUrl),
          bundleNetworkKeyRingProvider.overrideWithValue(update.keyRing),
        ],
      );
      addTearDown(container.dispose);

      final sync = await container.read(currencyBundleSyncProvider.future);
      unawaited(sync.sync(BundleSyncTrigger.startup));
      final view = await container
          .read(currencyCatalogViewProvider.future)
          .timeout(const Duration(seconds: 2));

      expect(view.snapshot.version, '1');
      expect(view.documents, hasLength(29));
      expect(view.documentsFor(CurrencyRouteKind.banknotes), hasLength(15));
    },
  );

  test(
    'invalid content is ignored and the fallback stays privacy-safe',
    () async {
      final root = await Directory.systemTemp.createTemp('ce1-ui-corrupt-');
      final server = await LoopbackBundleServer.start();
      addTearDown(() async {
        await server.close();
        if (await root.exists()) await root.delete(recursive: true);
      });
      final invalid = await TestSignedBundle.create(
        version: '1',
        resources: [
          TestBundleResource(
            logicalId: 'content.invalid',
            bytes: Uint8List.fromList(utf8.encode('{"not":"currency"}')),
          ),
        ],
      );
      server
        ..manifestBytes = invalid.envelopeBytes
        ..resources.addAll(invalid.resources);
      final store = BundleStore(
        documentsRoot: root,
        loadAsset: loadSeedAsset,
        networkKeyRing: invalid.keyRing,
        versionedUrl: server.versionedUrl,
      );
      final seedView = await CurrencyCatalogView.load(await store.bootstrap());
      final client = BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl,
      );
      addTearDown(client.close);
      final staged = await store.stage(
        envelope: invalid.envelope,
        envelopeBytes: invalid.envelopeBytes,
        client: client,
      );
      final replacement = await store.activate(staged);
      final baseline = await CurrencySeedBaseline.load(loadSeedAsset);

      final corruptView = await CurrencyCatalogView.load(
        replacement,
        seedBaseline: baseline,
      );
      expect(corruptView.documents, hasLength(29));
      expect(corruptView.safeFailureCode, isNull);
      expect(seedView.documents, hasLength(29));
      expect(seedView.snapshot.version, '0');
    },
  );

  test(
    'published security features stay associated and only safe links resolve',
    () async {
      final root = await Directory.systemTemp.createTemp('ce1-ui-published-');
      final server = await LoopbackBundleServer.start();
      addTearDown(() async {
        await server.close();
        if (await root.exists()) await root.delete(recursive: true);
      });
      const firstItemId = '11111111-1111-4111-8111-111111111111';
      const secondItemId = '22222222-2222-4222-8222-222222222222';
      const featureItemId = '33333333-3333-4333-8333-333333333333';
      final resources = <TestBundleResource>[
        _publishedResource(
          contentItemId: firstItemId,
          contentVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          contentType: 'coin',
          denominationCode: 'php-1',
          title: 'Published one-peso coin',
          relatedLinks: const [
            {
              'id': '44444444-4444-4444-8444-444444444444',
              'position': 0,
              'kind': 'internal',
              'label': 'Protected profile',
              'route': '/profile',
            },
            {
              'id': '55555555-5555-4555-8555-555555555555',
              'position': 1,
              'kind': 'topic',
              'label': 'Related five-peso coin',
              'targetContentItemId': secondItemId,
            },
          ],
        ),
        _publishedResource(
          contentItemId: secondItemId,
          contentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          contentType: 'coin',
          denominationCode: 'php-5',
          title: 'Published five-peso coin',
        ),
        _publishedResource(
          contentItemId: featureItemId,
          contentVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          contentType: 'security_feature',
          denominationCode: 'php-1',
          title: 'Verified educational feature',
        ),
      ];
      final update = await TestSignedBundle.create(
        version: '1',
        resources: resources,
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
      final client = BundleClient(
        dio: Dio(),
        versionedUrl: server.versionedUrl,
      );
      addTearDown(client.close);
      final staged = await store.stage(
        envelope: update.envelope,
        envelopeBytes: update.envelopeBytes,
        client: client,
      );

      final baseline = await CurrencySeedBaseline.load(loadSeedAsset);
      final view = await CurrencyCatalogView.load(
        await store.activate(staged),
        seedBaseline: baseline,
      );
      final first = view.resolve(
        CurrencyRouteKind.coins,
        'content.$firstItemId',
      )!;

      expect(view.documents, hasLength(29));
      expect(
        view.securityFeaturesFor(first).map((document) => document.title),
        ['Verified educational feature'],
      );
      expect(
        first.relatedLinks.map((link) => link.kind),
        containsAll([
          CurrencyRelatedLinkKind.external,
          CurrencyRelatedLinkKind.internal,
          CurrencyRelatedLinkKind.topic,
        ]),
      );
      expect(view.resolveInternalRoute('/profile'), isNull);
      expect(
        view.resolveTopic(secondItemId)?.logicalId,
        'content.$secondItemId',
      );
      expect(view.resolveTopic(featureItemId), isNull);
      expect(view.resolveTopic('not-a-known-content-id'), isNull);
      expect(
        view.snapshot.entries.every(
          (entry) =>
              entry.logicalId.startsWith('content.') &&
              entry.contentItemId != null &&
              entry.contentVersionId != null,
        ),
        isTrue,
      );
      expect(await view.readImage(first), isNotNull);

      final next = await TestSignedBundle.create(
        version: '2',
        resources: [
          _publishedResource(
            contentItemId: secondItemId,
            contentVersionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            contentType: 'coin',
            denominationCode: 'php-5',
            title: 'Updated five-peso coin',
          ),
        ],
      );
      server
        ..manifestBytes = next.envelopeBytes
        ..resources.addAll(next.resources);
      final nextStage = await store.stage(
        envelope: next.envelope,
        envelopeBytes: next.envelopeBytes,
        client: client,
      );
      final nextView = await CurrencyCatalogView.load(
        await store.activate(nextStage),
        seedBaseline: baseline,
      );

      expect(nextView.documents, hasLength(29));
      expect(
        nextView.resolve(CurrencyRouteKind.coins, 'content.$firstItemId'),
        isNull,
      );
      final restored = nextView.resolve(
        CurrencyRouteKind.coins,
        'catalog.ngc-coins.php-1',
      )!;
      expect(nextView.securityFeaturesFor(restored), isEmpty);
      expect(await nextView.readImage(restored), isNotNull);
      expect(
        view.resolve(CurrencyRouteKind.coins, 'content.$firstItemId'),
        first,
      );
      expect(view.securityFeaturesFor(first), hasLength(1));
    },
  );

  test(
    'sync state queues the terminal transition before yielding its snapshot',
    () async {
      final sync = _RaceCurrencyBundleSync();
      final container = ProviderContainer(
        overrides: [
          currencyBundleSyncProvider.overrideWith((ref) async => sync),
        ],
      );
      addTearDown(container.dispose);
      final phases = <BundleSyncPhase>[];
      final terminal = Completer<void>();
      final subscription = container.listen(currencyBundleSyncStateProvider, (
        previous,
        next,
      ) {
        final phase = next.asData?.value.phase;
        if (phase == null) return;
        phases.add(phase);
        if (phase == BundleSyncPhase.checking) {
          sync.emit(
            const BundleSyncState(phase: BundleSyncPhase.active, version: '1'),
          );
        }
        if (phase == BundleSyncPhase.active && !terminal.isCompleted) {
          terminal.complete();
        }
      }, fireImmediately: true);
      addTearDown(subscription.close);

      await terminal.future.timeout(const Duration(seconds: 1));

      expect(phases, [BundleSyncPhase.checking, BundleSyncPhase.active]);
    },
  );
}

TestBundleResource _publishedResource({
  required String contentItemId,
  required String contentVersionId,
  required String contentType,
  required String denominationCode,
  required String title,
  List<Map<String, Object?>> relatedLinks = const [],
}) {
  return TestBundleResource(
    logicalId: 'content.$contentItemId',
    contentItemId: contentItemId,
    contentVersionId: contentVersionId,
    bytes: Uint8List.fromList(
      utf8.encode(
        jsonEncode({
          'schemaVersion': 1,
          'logicalId': 'content.$contentItemId',
          'contentItemId': contentItemId,
          'contentVersionId': contentVersionId,
          'versionNo': 1,
          'contentType': contentType,
          'title': title,
          'summary': 'Verified saved educational summary.',
          'body': 'Verified saved educational body.',
          'seriesCode': 'ngc-coins',
          'denominationCode': denominationCode,
          'primaryUrl': null,
          'featureLevel': contentType == 'security_feature' ? 'first' : null,
          'hotspot': null,
          'relatedLinks': relatedLinks,
        }),
      ),
    ),
  );
}

final class _RaceCurrencyBundleSync implements CurrencyBundleSync {
  final _states = StreamController<BundleSyncState>.broadcast(sync: true);
  BundleSyncState _state = const BundleSyncState(
    phase: BundleSyncPhase.checking,
  );

  @override
  BundleSyncState get state => _state;

  @override
  Stream<BundleSyncState> get states => _states.stream;

  void emit(BundleSyncState state) {
    _state = state;
    _states.add(state);
  }

  @override
  Future<void> sync(BundleSyncTrigger trigger) async {}
}
