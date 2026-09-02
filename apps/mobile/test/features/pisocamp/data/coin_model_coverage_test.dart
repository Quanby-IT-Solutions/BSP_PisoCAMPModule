import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';

import 'bundle_test_support.dart';

/// CE-2 AC6: every mandatory coin has a working model.
///
/// The check is made against the bundle itself rather than against a list kept
/// beside it — the manifest, the resource index and the catalog documents are
/// the same artefacts a device reads, so a coin that would render a fallback
/// notice on a phone fails here instead.
///
/// Annex H names fourteen mandatory coins: seven in the New Generation
/// Currency coin series and seven in the BSP Coin Series.
const _mandatoryCoinSeries = <String, int>{
  'ngc-coins': 7,
  'bsp-coin-series': 7,
};

const _envelopeAsset = 'assets/pisocamp/bundle/seed/manifest.envelope.json';
const _indexAsset = 'assets/pisocamp/bundle/seed/resource-index.json';

void main() {
  late BundleManifest manifest;
  late Map<String, String> resourceIndex;
  late List<CurrencyContentDocument> documents;

  setUpAll(() async {
    final envelope = await BundleEnvelope.parseAndVerify(
      await loadSeedAsset(_envelopeAsset),
      BundleKeyRing.packagedSeed(),
    );
    manifest = envelope.manifest;
    final index = decodeStrictJsonObject(
      await loadSeedAsset(_indexAsset),
      maximumBytes: 65536,
      context: 'coverage resource index',
    );
    resourceIndex = <String, String>{
      for (final entry in index.entries) entry.key: entry.value! as String,
    };
    documents = <CurrencyContentDocument>[
      for (final entry in manifest.entries)
        if (entry.kind == BundleEntryKind.content)
          CurrencyContentDocument.parseSeed(
            await loadSeedAsset(resourceIndex[entry.sha256]!),
          ),
    ];
  });

  Future<Uint8List> readResource(String digest) async {
    final entry = manifest.entries.firstWhere(
      (candidate) => candidate.sha256 == digest,
      orElse: () => throw StateError('no manifest entry for $digest'),
    );
    final bytes = await loadSeedAsset(resourceIndex[digest]!);
    // The same integrity gate the device applies before it renders anything.
    await entry.validateResource(bytes);
    return bytes;
  }

  test('the bundle carries all fourteen mandatory coins', () {
    final coins = documents
        .where((document) => document.kind == CurrencyContentKind.coin)
        .toList();

    expect(coins, hasLength(14));
    for (final series in _mandatoryCoinSeries.entries) {
      expect(
        coins.where((coin) => coin.seriesCode == series.key),
        hasLength(series.value),
        reason: '${series.key} must carry ${series.value} denominations',
      );
    }
    // Denominations are distinct, so fourteen entries really are fourteen
    // coins rather than one coin counted fourteen times.
    expect(
      coins
          .map((coin) => '${coin.seriesCode}/${coin.denominationCode}')
          .toSet(),
      hasLength(14),
    );
  });

  test('every mandatory coin resolves a model that renders', () async {
    final coins = documents.where(
      (document) => document.kind == CurrencyContentKind.coin,
    );

    for (final coin in coins) {
      expect(
        coin.hasModel,
        isTrue,
        reason: '${coin.logicalId} must carry a 3D model',
      );
      final digest = coin.modelSha256!;
      final entry = manifest.entries.firstWhere(
        (candidate) => candidate.sha256 == digest,
        orElse: () =>
            throw StateError('${coin.logicalId} names no bundle entry'),
      );
      expect(entry.kind, BundleEntryKind.model, reason: coin.logicalId);
      expect(entry.mediaType, 'model/gltf-binary', reason: coin.logicalId);
      // A core entry ships with the bundle, so the viewer works offline from
      // the first run rather than after a separate download.
      expect(entry.delivery, BundleEntryDelivery.core, reason: coin.logicalId);

      final model = CoinModel.parse(await readResource(digest));
      expect(model.triangleCount, greaterThan(0), reason: coin.logicalId);
      expect(model.radius, greaterThan(0), reason: coin.logicalId);
      expect(
        coin.modelAlt,
        contains('not a reproduction'),
        reason: '${coin.logicalId} must say the model is not a reproduction',
      );
    }
  });

  test('banknotes carry no model, because banknote 3D is out of scope', () {
    final banknotes = documents.where(
      (document) => document.kind == CurrencyContentKind.banknote,
    );

    expect(banknotes, isNotEmpty);
    for (final banknote in banknotes) {
      expect(banknote.hasModel, isFalse, reason: banknote.logicalId);
      expect(banknote.modelSha256, isNull, reason: banknote.logicalId);
    }
  });

  test('the bundle holds exactly one model resource, shared by every coin', () {
    final modelEntries = manifest.entries.where(
      (entry) => entry.kind == BundleEntryKind.model,
    );

    expect(modelEntries, hasLength(1));
    final digests = documents
        .where((document) => document.kind == CurrencyContentKind.coin)
        .map((coin) => coin.modelSha256)
        .toSet();
    expect(digests, {modelEntries.first.sha256});
  });
}
