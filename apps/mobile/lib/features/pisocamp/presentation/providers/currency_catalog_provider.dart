import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/advisory_document.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/data/trivia_question_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/bundle_provider.dart';

enum CurrencyRouteKind {
  banknotes('banknotes', CurrencyContentKind.banknote, 'Banknotes'),
  coins('coins', CurrencyContentKind.coin, 'Coins');

  const CurrencyRouteKind(this.pathSegment, this.contentKind, this.title);

  final String pathSegment;
  final CurrencyContentKind contentKind;
  final String title;

  static CurrencyRouteKind? fromPathSegment(String value) {
    for (final kind in values) {
      if (kind.pathSegment == value) return kind;
    }
    return null;
  }
}

final class CurrencySeriesGroup {
  const CurrencySeriesGroup({
    required this.code,
    required this.name,
    required this.order,
    required this.documents,
  });

  final String code;
  final String name;
  final int order;
  final List<CurrencyContentDocument> documents;
}

/// Immutable, independently verified packaged catalog/resources used as the
/// trusted display baseline for every active published-only bundle snapshot.
final class CurrencySeedBaseline {
  CurrencySeedBaseline._(List<_SeedBaselineResource> resources)
    : _resources = List.unmodifiable(resources);

  static const _envelopeAsset =
      'assets/pisocamp/bundle/seed/manifest.envelope.json';
  static const _indexAsset = 'assets/pisocamp/bundle/seed/resource-index.json';

  final List<_SeedBaselineResource> _resources;

  static Future<CurrencySeedBaseline> load(
    BundleAssetLoader? assetLoader,
  ) async {
    final loadAsset = assetLoader ?? _loadBundleAsset;
    final envelope = await BundleEnvelope.parseAndVerify(
      await loadAsset(_envelopeAsset),
      BundleKeyRing.packagedSeed(),
    );
    if (envelope.manifest.bundleVersion != '0') {
      throw const BundleStoreException('seed_version_invalid');
    }
    final index = decodeStrictJsonObject(
      await loadAsset(_indexAsset),
      maximumBytes: 65536,
      context: 'packaged currency display index',
    );
    final resources = <_SeedBaselineResource>[];
    for (final entry in envelope.manifest.entries) {
      final assetPath = index[entry.sha256];
      if (assetPath is! String || !_isSafeSeedAsset(entry, assetPath)) {
        throw const BundleStoreException('seed_index_invalid');
      }
      final bytes = await loadAsset(assetPath);
      try {
        await entry.validateResource(bytes);
      } on BundleValidationException {
        throw const BundleStoreException('seed_resource_invalid');
      }
      resources.add(
        _SeedBaselineResource(entry: entry, bytes: Uint8List.fromList(bytes)),
      );
    }
    return CurrencySeedBaseline._(resources);
  }

  /// Each packaged asset path is named here rather than pattern-matched, so a
  /// tampered index cannot point a manifest entry at some other bundled file.
  static bool _isSafeSeedAsset(BundleManifestEntry entry, String assetPath) {
    return switch (entry.kind) {
      BundleEntryKind.content =>
        assetPath ==
            'assets/pisocamp/bundle/seed/resources/${entry.sha256}.json',
      BundleEntryKind.image => const {
        'assets/pisocamp/bundle/seed/source/neutral-banknote-education.png',
        'assets/pisocamp/bundle/seed/source/neutral-coin-education.png',
      }.contains(assetPath),
      BundleEntryKind.model =>
        assetPath ==
            'assets/pisocamp/bundle/seed/source/neutral-coin-education.glb',
    };
  }
}

final class _SeedBaselineResource {
  const _SeedBaselineResource({required this.entry, required this.bytes});

  final BundleManifestEntry entry;
  final Uint8List bytes;
}

final class _VerifiedBundleResource {
  const _VerifiedBundleResource({required this.mediaType, required this.read});

  final String mediaType;
  final Future<Uint8List> Function() read;
}

/// Bounded raster bytes that passed manifest integrity and intrinsic-size
/// checks before reaching Flutter's image decoder.
final class VerifiedCurrencyImage {
  const VerifiedCurrencyImage._({
    required this.bytes,
    required this.width,
    required this.height,
  });

  static const maximumDimension = 8192;
  static const maximumPixels = 24 * 1000 * 1000;
  static const maximumCacheDimension = 1600;

  final Uint8List bytes;
  final int width;
  final int height;

  int get cacheWidth {
    if (width <= maximumCacheDimension && height <= maximumCacheDimension) {
      return width;
    }
    if (width >= height) return maximumCacheDimension;
    final scaled = (width * maximumCacheDimension / height).round();
    return scaled < 1 ? 1 : scaled;
  }

  int get cacheHeight {
    if (width <= maximumCacheDimension && height <= maximumCacheDimension) {
      return height;
    }
    if (height >= width) return maximumCacheDimension;
    final scaled = (height * maximumCacheDimension / width).round();
    return scaled < 1 ? 1 : scaled;
  }

  static VerifiedCurrencyImage? parse(Uint8List bytes, String mediaType) {
    final dimensions = switch (mediaType) {
      'image/png' => _pngDimensions(bytes),
      'image/jpeg' => _jpegDimensions(bytes),
      'image/webp' => _webpDimensions(bytes),
      _ => null,
    };
    if (dimensions == null ||
        dimensions.$1 <= 0 ||
        dimensions.$2 <= 0 ||
        dimensions.$1 > maximumDimension ||
        dimensions.$2 > maximumDimension ||
        dimensions.$1 * dimensions.$2 > maximumPixels) {
      return null;
    }
    return VerifiedCurrencyImage._(
      bytes: Uint8List.fromList(bytes),
      width: dimensions.$1,
      height: dimensions.$2,
    );
  }
}

/// A display projection over exactly one verified active-bundle snapshot.
/// The projection never subscribes to future activations, so reads made by an
/// open list/detail lifecycle cannot mix manifests or object directories.
final class CurrencyCatalogView {
  CurrencyCatalogView._({
    required this.snapshot,
    required List<CurrencyContentDocument> documents,
    required Map<String, List<CurrencyContentDocument>> securityFeatures,
    required Map<String, _VerifiedBundleResource> images,
    required Map<String, _VerifiedBundleResource> models,
    required List<TriviaQuestionDocument> triviaQuestions,
    required List<SurveyDocument> surveys,
    required List<AdvisoryDocument> advisories,
  }) : documents = List.unmodifiable(documents),
       triviaQuestions = List.unmodifiable(triviaQuestions),
       surveys = List.unmodifiable(surveys),
       advisories = List.unmodifiable(advisories),
       _securityFeatures =
           Map.unmodifiable(<String, List<CurrencyContentDocument>>{
             for (final entry in securityFeatures.entries)
               entry.key: List.unmodifiable(entry.value),
           }),
       _images = Map.unmodifiable(images),
       _models = Map.unmodifiable(models),
       safeFailureCode = documents.isEmpty ? 'saved_content_unavailable' : null;

  final ActiveCurrencyCatalog snapshot;
  final List<CurrencyContentDocument> documents;

  /// GM-2's question pool, read from the same verified snapshot as everything
  /// else. Only published and active questions reach a device, so this list is
  /// the pool: there is nothing further to filter.
  final List<TriviaQuestionDocument> triviaQuestions;

  /// EV-2's published surveys, read from the same verified snapshot. A survey
  /// travels with the bundle because it is offered offline.
  final List<SurveyDocument> surveys;

  /// EV-4's published advisories. Read from the bundle for the same reason:
  /// somebody leaving the module may have no connection.
  final List<AdvisoryDocument> advisories;

  final Map<String, List<CurrencyContentDocument>> _securityFeatures;
  final Map<String, _VerifiedBundleResource> _images;
  final Map<String, _VerifiedBundleResource> _models;
  final Map<String, Future<VerifiedCurrencyImage?>> _imageReads = {};
  final Map<String, VerifiedCurrencyImage> _loadedImages = {};
  final Map<String, Future<CoinModel>> _modelReads = {};
  final String? safeFailureCode;

  static Future<CurrencyCatalogView> load(
    ActiveCurrencyCatalog snapshot, {
    CurrencySeedBaseline? seedBaseline,
  }) async {
    final seedDocuments = <CurrencyContentDocument>[];
    final publishedBytes = <Uint8List>[];
    final images = <String, _VerifiedBundleResource>{};
    final models = <String, _VerifiedBundleResource>{};

    final baselineResources = seedBaseline?._resources;
    if (baselineResources != null) {
      for (final resource in baselineResources) {
        final entry = resource.entry;
        if (entry.kind == BundleEntryKind.image ||
            entry.kind == BundleEntryKind.model) {
          final target = entry.kind == BundleEntryKind.image ? images : models;
          target[entry.sha256] = _VerifiedBundleResource(
            mediaType: entry.mediaType,
            read: () async => Uint8List.fromList(resource.bytes),
          );
          continue;
        }
        if (entry.kind == BundleEntryKind.content &&
            entry.mediaType == 'application/json' &&
            entry.logicalId.startsWith('catalog.')) {
          final document = CurrencyContentDocument.parseSeed(resource.bytes);
          if (document.logicalId != entry.logicalId) {
            throw const BundleStoreException('seed_resource_invalid');
          }
          seedDocuments.add(document);
        }
      }
      if (seedDocuments.length != 29) {
        throw const BundleStoreException('seed_catalog_invalid');
      }
    } else {
      for (final entry in snapshot.entries) {
        if (entry.kind == BundleEntryKind.image ||
            entry.kind == BundleEntryKind.model) {
          final target = entry.kind == BundleEntryKind.image ? images : models;
          target[entry.sha256] = _VerifiedBundleResource(
            mediaType: entry.mediaType,
            read: () => snapshot.readBytes(entry),
          );
          continue;
        }
        if (entry.kind != BundleEntryKind.content ||
            entry.mediaType != 'application/json' ||
            !entry.logicalId.startsWith('catalog.')) {
          continue;
        }
        try {
          final bytes = await snapshot.readBytes(entry);
          final document = CurrencyContentDocument.parseSeed(bytes);
          if (document.logicalId == entry.logicalId) {
            seedDocuments.add(document);
          }
        } on Object {
          // Invalid resources never escape the verified display boundary.
        }
      }
    }

    for (final entry in snapshot.entries) {
      if (entry.kind == BundleEntryKind.image ||
          entry.kind == BundleEntryKind.model) {
        final target = entry.kind == BundleEntryKind.image ? images : models;
        target[entry.sha256] = _VerifiedBundleResource(
          mediaType: entry.mediaType,
          read: () => snapshot.readBytes(entry),
        );
        continue;
      }
      if (entry.kind != BundleEntryKind.content ||
          entry.mediaType != 'application/json') {
        continue;
      }
      try {
        if (!entry.logicalId.startsWith('catalog.')) {
          publishedBytes.add(await snapshot.readBytes(entry));
        }
      } on Object {
        // Invalid resources never escape the verified/strict display boundary.
      }
    }

    CurrencyCatalogLookup? lookup;
    try {
      lookup = CurrencyCatalogLookup.fromSeedDocuments(seedDocuments);
    } on Object {
      lookup = null;
    }

    final baseByDenomination = <String, CurrencyContentDocument>{};
    for (final document in seedDocuments) {
      baseByDenomination[_denominationKey(document)] = document;
    }
    final triviaQuestions = <TriviaQuestionDocument>[];
    for (final bytes in publishedBytes) {
      try {
        triviaQuestions.add(TriviaQuestionDocument.parsePublished(bytes));
      } on Object {
        // Not a question, or not a readable one. Either way it is not offered.
      }
    }
    final advisories = <AdvisoryDocument>[];
    for (final bytes in publishedBytes) {
      try {
        advisories.add(AdvisoryDocument.parsePublished(bytes));
      } on Object {
        // Not an advisory, or not a readable one. Either way it is not shown.
      }
    }

    final surveys = <SurveyDocument>[];
    for (final bytes in publishedBytes) {
      try {
        surveys.add(SurveyDocument.parsePublished(bytes));
      } on Object {
        // Not a survey, or not a readable one. Either way it is not offered.
      }
    }
    surveys.sort(
      (left, right) => left.contentItemId.compareTo(right.contentItemId),
    );
    triviaQuestions.sort(
      (left, right) => left.contentItemId.compareTo(right.contentItemId),
    );

    final securityFeatures = <String, List<CurrencyContentDocument>>{};
    if (lookup != null) {
      for (final bytes in publishedBytes) {
        try {
          final document = CurrencyContentDocument.parsePublished(
            bytes,
            lookup,
          );
          final key = _denominationKey(document);
          if (document.kind == CurrencyContentKind.securityFeature) {
            securityFeatures.putIfAbsent(key, () => []).add(document);
          } else {
            baseByDenomination[key] = document;
          }
        } on Object {
          // Ignore malformed/non-currency published resources without leaking
          // parser or storage details into the guest surface.
        }
      }
    }

    final documents = baseByDenomination.values.toList()
      ..sort(_compareDocuments);
    for (final features in securityFeatures.values) {
      features.sort(_compareDocuments);
    }
    return CurrencyCatalogView._(
      snapshot: snapshot,
      documents: documents,
      securityFeatures: securityFeatures,
      images: images,
      models: models,
      triviaQuestions: triviaQuestions,
      surveys: surveys,
      advisories: advisories,
    );
  }

  List<CurrencySeriesGroup> get series {
    final groups = <String, List<CurrencyContentDocument>>{};
    for (final document in documents) {
      groups.putIfAbsent(document.seriesCode, () => []).add(document);
    }
    final result =
        [
          for (final entry in groups.entries)
            CurrencySeriesGroup(
              code: entry.key,
              name: entry.value.first.seriesName,
              order: entry.value.first.seriesOrder,
              documents: List.unmodifiable(entry.value),
            ),
        ]..sort((left, right) {
          final order = left.order.compareTo(right.order);
          return order != 0 ? order : left.code.compareTo(right.code);
        });
    return List.unmodifiable(result);
  }

  List<CurrencySeriesGroup> seriesFor(CurrencyRouteKind kind) {
    return List.unmodifiable(
      series
          .where((group) => group.documents.first.kind == kind.contentKind)
          .toList(),
    );
  }

  List<CurrencyContentDocument> documentsFor(CurrencyRouteKind kind) {
    return List.unmodifiable(
      documents.where((document) => document.kind == kind.contentKind),
    );
  }

  CurrencyContentDocument? resolve(CurrencyRouteKind kind, String logicalId) {
    if (!isValidCurrencyLogicalId(logicalId)) return null;
    for (final document in documentsFor(kind)) {
      if (document.logicalId == logicalId) return document;
    }
    return null;
  }

  List<CurrencyContentDocument> securityFeaturesFor(
    CurrencyContentDocument document,
  ) {
    return _securityFeatures[_denominationKey(document)] ?? const [];
  }

  CurrencyContentDocument? resolveTopic(String? contentItemId) {
    if (contentItemId == null) return null;
    for (final document in documents) {
      if (document.contentItemId == contentItemId) return document;
    }
    return null;
  }

  CurrencyContentDocument? resolveInternalRoute(String? route) {
    if (route == null) return null;
    final uri = Uri.tryParse(route);
    if (uri == null ||
        uri.hasScheme ||
        uri.hasAuthority ||
        uri.hasQuery ||
        uri.hasFragment ||
        uri.pathSegments.length != 4 ||
        uri.pathSegments[0] != 'pisocamp' ||
        uri.pathSegments[1] != 'currency') {
      return null;
    }
    final kind = CurrencyRouteKind.fromPathSegment(uri.pathSegments[2]);
    return kind == null ? null : resolve(kind, uri.pathSegments[3]);
  }

  Future<VerifiedCurrencyImage?> readImage(CurrencyContentDocument document) {
    final digest = document.imageSha256;
    if (digest == null) return Future.value(null);
    final resource = _images[digest];
    if (resource == null ||
        !const {
          'image/png',
          'image/jpeg',
          'image/webp',
        }.contains(resource.mediaType)) {
      return Future.value(null);
    }
    return _imageReads.putIfAbsent(
      digest,
      () => _readImage(resource).then((image) {
        if (image != null) _loadedImages[digest] = image;
        return image;
      }),
    );
  }

  VerifiedCurrencyImage? loadedImage(CurrencyContentDocument document) {
    final digest = document.imageSha256;
    return digest == null ? null : _loadedImages[digest];
  }

  /// Reads and parses the 3D model this document names.
  ///
  /// Throws [CoinModelException] rather than returning null so the viewer can
  /// tell "this denomination has no model" from "the bundle is missing it"
  /// from "the bytes will not parse", and say which.
  Future<CoinModel> readModel(CurrencyContentDocument document) {
    final digest = document.modelSha256;
    if (digest == null || !document.hasModel) {
      return Future.error(
        const CoinModelException(CoinModelFailure.unavailable),
      );
    }
    final resource = _models[digest];
    if (resource == null || resource.mediaType != 'model/gltf-binary') {
      return Future.error(
        const CoinModelException(CoinModelFailure.missingResource),
      );
    }
    return _modelReads.putIfAbsent(digest, () async {
      final Uint8List bytes;
      try {
        bytes = await resource.read();
      } on Object {
        throw const CoinModelException(CoinModelFailure.missingResource);
      }
      return CoinModel.parse(bytes);
    });
  }

  Future<VerifiedCurrencyImage?> _readImage(
    _VerifiedBundleResource resource,
  ) async {
    try {
      return VerifiedCurrencyImage.parse(
        await resource.read(),
        resource.mediaType,
      );
    } on Object {
      return null;
    }
  }
}

abstract interface class CurrencyBundleSync {
  BundleSyncState get state;
  Stream<BundleSyncState> get states;
  Future<void> sync(BundleSyncTrigger trigger);
}

final class _ControllerCurrencyBundleSync implements CurrencyBundleSync {
  const _ControllerCurrencyBundleSync(this._controller);

  final BundleSyncController _controller;

  @override
  BundleSyncState get state => _controller.state;

  @override
  Stream<BundleSyncState> get states => _controller.states;

  @override
  Future<void> sync(BundleSyncTrigger trigger) => _controller.sync(trigger);
}

final currencyBundleSyncProvider = FutureProvider<CurrencyBundleSync>((
  ref,
) async {
  return _ControllerCurrencyBundleSync(
    await ref.watch(bundleSyncControllerProvider.future),
  );
});

final currencyBundleSyncStateProvider = StreamProvider<BundleSyncState>((
  ref,
) async* {
  final sync = await ref.watch(currencyBundleSyncProvider.future);
  final queued = StreamController<BundleSyncState>(sync: true);
  final subscription = sync.states.listen(
    queued.add,
    onError: queued.addError,
    onDone: queued.close,
  );
  ref.onDispose(() => unawaited(subscription.cancel()));
  try {
    var last = sync.state;
    yield last;
    await for (final candidate in queued.stream) {
      if (_sameSyncState(last, candidate)) continue;
      last = candidate;
      yield candidate;
    }
  } finally {
    await subscription.cancel();
    if (!queued.isClosed) await queued.close();
  }
});

final currencyCatalogViewProvider = FutureProvider<CurrencyCatalogView>((
  ref,
) async {
  final readActive = await ref.watch(activeCurrencyCatalogReadProvider.future);
  final snapshot = await readActive();
  final baseline = await ref.watch(currencySeedBaselineProvider.future);
  return CurrencyCatalogView.load(snapshot, seedBaseline: baseline);
});

final currencySeedBaselineProvider = FutureProvider<CurrencySeedBaseline>((
  ref,
) {
  return CurrencySeedBaseline.load(ref.watch(bundleAssetLoaderProvider));
});

bool isValidCurrencyLogicalId(String value) {
  return value.length <= 160 &&
      RegExp(r'^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$').hasMatch(value);
}

bool _sameSyncState(BundleSyncState left, BundleSyncState right) {
  return left.phase == right.phase &&
      left.code == right.code &&
      left.version == right.version;
}

String _denominationKey(CurrencyContentDocument document) {
  return '${document.seriesCode}\u0000${document.denominationCode}';
}

int _compareDocuments(
  CurrencyContentDocument left,
  CurrencyContentDocument right,
) {
  final series = left.seriesOrder.compareTo(right.seriesOrder);
  if (series != 0) return series;
  final denomination = left.denominationOrder.compareTo(
    right.denominationOrder,
  );
  if (denomination != 0) return denomination;
  return left.logicalId.compareTo(right.logicalId);
}

(int, int)? _pngDimensions(Uint8List bytes) {
  if (bytes.length < 24 ||
      !_matches(bytes, 0, const [137, 80, 78, 71, 13, 10, 26, 10]) ||
      !_matches(bytes, 12, const [73, 72, 68, 82])) {
    return null;
  }
  return (_readBigEndian32(bytes, 16), _readBigEndian32(bytes, 20));
}

(int, int)? _jpegDimensions(Uint8List bytes) {
  if (bytes.length < 4 || bytes[0] != 255 || bytes[1] != 216) return null;
  var offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] != 255) return null;
    while (offset < bytes.length && bytes[offset] == 255) {
      offset += 1;
    }
    if (offset >= bytes.length) return null;
    final marker = bytes[offset++];
    if (marker == 216 || marker == 217) continue;
    if (offset + 1 >= bytes.length) return null;
    final length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    const sizeMarkers = {
      0xc0,
      0xc1,
      0xc2,
      0xc3,
      0xc5,
      0xc6,
      0xc7,
      0xc9,
      0xca,
      0xcb,
      0xcd,
      0xce,
      0xcf,
    };
    if (sizeMarkers.contains(marker)) {
      if (length < 7) return null;
      final height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      final width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return (width, height);
    }
    offset += length;
  }
  return null;
}

(int, int)? _webpDimensions(Uint8List bytes) {
  if (bytes.length < 25 ||
      !_matches(bytes, 0, const [82, 73, 70, 70]) ||
      !_matches(bytes, 8, const [87, 69, 66, 80])) {
    return null;
  }
  if (_matches(bytes, 12, const [86, 80, 56, 88]) && bytes.length >= 30) {
    return (
      1 + _readLittleEndian24(bytes, 24),
      1 + _readLittleEndian24(bytes, 27),
    );
  }
  if (_matches(bytes, 12, const [86, 80, 56, 32]) &&
      bytes.length >= 30 &&
      _matches(bytes, 23, const [157, 1, 42])) {
    return (
      ((bytes[27] << 8) | bytes[26]) & 0x3fff,
      ((bytes[29] << 8) | bytes[28]) & 0x3fff,
    );
  }
  if (_matches(bytes, 12, const [86, 80, 56, 76]) && bytes[20] == 47) {
    final b1 = bytes[21];
    final b2 = bytes[22];
    final b3 = bytes[23];
    final b4 = bytes[24];
    return (
      1 + b1 + ((b2 & 0x3f) << 8),
      1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    );
  }
  return null;
}

bool _matches(Uint8List bytes, int offset, List<int> expected) {
  if (offset < 0 || offset + expected.length > bytes.length) return false;
  for (var index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] != expected[index]) return false;
  }
  return true;
}

int _readBigEndian32(Uint8List bytes, int offset) {
  return (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
}

int _readLittleEndian24(Uint8List bytes, int offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

Future<Uint8List> _loadBundleAsset(String assetPath) async {
  final data = await rootBundle.load(assetPath);
  return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
}
