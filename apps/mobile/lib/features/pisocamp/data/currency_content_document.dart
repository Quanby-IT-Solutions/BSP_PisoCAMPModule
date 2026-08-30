import 'dart:typed_data';

import 'bundle_protocol.dart';

enum CurrencyContentKind { banknote, coin, securityFeature }

enum CurrencyRelatedLinkKind { external, internal, topic }

final class CurrencyRelatedLink {
  const CurrencyRelatedLink._({
    required this.kind,
    required this.label,
    required this.id,
    required this.position,
    required this.url,
    required this.route,
    required this.targetContentItemId,
  });

  final CurrencyRelatedLinkKind kind;
  final String label;
  final String? id;
  final int? position;
  final Uri? url;
  final String? route;
  final String? targetContentItemId;
}

final class CurrencyContentDocument {
  CurrencyContentDocument._({
    required this.logicalId,
    required this.kind,
    required this.seriesCode,
    required this.seriesName,
    required this.seriesOrder,
    required this.denominationCode,
    required this.denominationLabel,
    required this.denominationOrder,
    required this.title,
    required this.summary,
    required this.body,
    required this.imageSha256,
    required this.imageAlt,
    required List<CurrencyRelatedLink> relatedLinks,
    required this.catalogVersion,
    required this.sourceUrl,
    required this.contentItemId,
    required this.contentVersionId,
    required this.versionNo,
  }) : relatedLinks = List.unmodifiable(relatedLinks);

  final String logicalId;
  final CurrencyContentKind kind;
  final String seriesCode;
  final String seriesName;
  final int seriesOrder;
  final String denominationCode;
  final String denominationLabel;
  final int denominationOrder;
  final String title;
  final String summary;
  final String body;
  final String? imageSha256;
  final String? imageAlt;
  final List<CurrencyRelatedLink> relatedLinks;
  final String catalogVersion;
  final Uri sourceUrl;
  final String? contentItemId;
  final String? contentVersionId;
  final int? versionNo;

  static CurrencyContentDocument parseSeed(Uint8List bytes) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumDocumentBytes,
      context: 'currency seed document',
    );
    requireExactJsonKeys(
      json,
      const {
        'schemaVersion',
        'logicalId',
        'contentType',
        'seriesCode',
        'seriesName',
        'seriesOrder',
        'denominationCode',
        'denominationLabel',
        'denominationOrder',
        'title',
        'summary',
        'body',
        'catalogVersion',
        'sourceUrl',
        'relatedLinks',
      },
      optionalKeys: const {'imageSha256', 'imageAlt'},
      context: 'currency seed document',
    );

    _requireSchemaVersion(json['schemaVersion']);
    final kind = _seedKind(_string(json, 'contentType', maximum: 32));
    final seriesCode = _code(json, 'seriesCode');
    final denominationCode = _code(json, 'denominationCode');
    _requireSeriesKind(seriesCode, kind);
    final logicalId = _string(json, 'logicalId', maximum: 160);
    if (logicalId != 'catalog.$seriesCode.$denominationCode') {
      throw const BundleValidationException(
        'Currency seed logicalId does not match its series and denomination.',
      );
    }

    final imageSha256 = _nullableDigest(json, 'imageSha256');
    final imageAlt = _nullablePlainText(json, 'imageAlt', maximum: 500);
    if ((imageSha256 == null) != (imageAlt == null)) {
      throw const BundleValidationException(
        'Currency image digest and alternative text must be provided together.',
      );
    }

    final sourceUrl = _bspUrl(json, 'sourceUrl');
    final relatedLinks = _seedRelatedLinks(json['relatedLinks']);
    if (!relatedLinks.any((link) => link.url == sourceUrl)) {
      throw const BundleValidationException(
        'Currency seed related links must include its BSP source URL.',
      );
    }

    return CurrencyContentDocument._(
      logicalId: logicalId,
      kind: kind,
      seriesCode: seriesCode,
      seriesName: _plainText(json, 'seriesName', maximum: 160),
      seriesOrder: _nonNegativeInt(json, 'seriesOrder'),
      denominationCode: denominationCode,
      denominationLabel: _plainText(json, 'denominationLabel', maximum: 100),
      denominationOrder: _nonNegativeInt(json, 'denominationOrder'),
      title: _plainText(json, 'title', maximum: 160),
      summary: _plainText(json, 'summary', maximum: 500),
      body: _plainText(json, 'body', maximum: 10000),
      imageSha256: imageSha256,
      imageAlt: imageAlt,
      relatedLinks: relatedLinks,
      catalogVersion: _plainText(json, 'catalogVersion', maximum: 64),
      sourceUrl: sourceUrl,
      contentItemId: null,
      contentVersionId: null,
      versionNo: null,
    );
  }

  static CurrencyContentDocument parsePublished(
    Uint8List bytes,
    CurrencyCatalogLookup catalog,
  ) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumDocumentBytes,
      context: 'published currency document',
    );
    requireExactJsonKeys(json, const {
      'schemaVersion',
      'logicalId',
      'contentItemId',
      'contentVersionId',
      'versionNo',
      'contentType',
      'title',
      'summary',
      'body',
      'seriesCode',
      'denominationCode',
      'primaryUrl',
      'relatedLinks',
    }, context: 'published currency document');

    _requireSchemaVersion(json['schemaVersion']);
    final contentItemId = _uuid(json, 'contentItemId');
    final contentVersionId = _uuid(json, 'contentVersionId');
    final logicalId = _string(json, 'logicalId', maximum: 160);
    if (logicalId != 'content.$contentItemId') {
      throw const BundleValidationException(
        'Published currency logicalId does not match its content item.',
      );
    }
    final kind = _publishedKind(_string(json, 'contentType', maximum: 32));
    final seriesCode = _code(json, 'seriesCode');
    final denominationCode = _code(json, 'denominationCode');
    final catalogEntry = catalog._find(seriesCode, denominationCode);
    if (kind != CurrencyContentKind.securityFeature &&
        kind != catalogEntry.kind) {
      throw const BundleValidationException(
        'Published currency kind does not match the frozen catalog.',
      );
    }
    if (json['primaryUrl'] != null) {
      throw const BundleValidationException(
        'Published currency primaryUrl must be null.',
      );
    }

    final publishedLinks = _publishedRelatedLinks(json['relatedLinks']);
    final relatedLinks = catalogEntry.relatedLinks.toList(growable: true);
    for (final link in publishedLinks) {
      final matchingCatalogIndex = link.url == null
          ? -1
          : relatedLinks.indexWhere(
              (existing) => existing.id == null && existing.url == link.url,
            );
      if (matchingCatalogIndex == -1) {
        relatedLinks.add(link);
      } else {
        relatedLinks[matchingCatalogIndex] = link;
      }
    }

    return CurrencyContentDocument._(
      logicalId: logicalId,
      kind: kind,
      seriesCode: catalogEntry.seriesCode,
      seriesName: catalogEntry.seriesName,
      seriesOrder: catalogEntry.seriesOrder,
      denominationCode: catalogEntry.denominationCode,
      denominationLabel: catalogEntry.denominationLabel,
      denominationOrder: catalogEntry.denominationOrder,
      title: _plainText(json, 'title', maximum: 160),
      summary: _plainText(json, 'summary', maximum: 500),
      body: _plainText(json, 'body', maximum: 10000),
      imageSha256: catalogEntry.imageSha256,
      imageAlt: catalogEntry.imageAlt,
      relatedLinks: relatedLinks,
      catalogVersion: catalogEntry.catalogVersion,
      sourceUrl: catalogEntry.sourceUrl,
      contentItemId: contentItemId,
      contentVersionId: contentVersionId,
      versionNo: _positiveInt(json, 'versionNo'),
    );
  }
}

final class CurrencyCatalogLookup {
  CurrencyCatalogLookup._(Map<String, CurrencyContentDocument> entries)
    : _entries = Map.unmodifiable(entries);

  factory CurrencyCatalogLookup.fromSeedDocuments(
    Iterable<CurrencyContentDocument> documents,
  ) {
    final entries = <String, CurrencyContentDocument>{};
    final logicalIds = <String>{};
    final series = <String, _SeriesIdentity>{};
    final seriesOrders = <int, String>{};
    final denominationOrders = <String, Set<int>>{};
    String? catalogVersion;

    for (final document in documents) {
      if (document.kind == CurrencyContentKind.securityFeature ||
          document.contentItemId != null ||
          document.contentVersionId != null ||
          document.versionNo != null) {
        throw const BundleValidationException(
          'Currency catalog lookup accepts seed catalog documents only.',
        );
      }
      if (!logicalIds.add(document.logicalId)) {
        throw const BundleValidationException(
          'Currency catalog contains a duplicate logicalId.',
        );
      }

      final key = _catalogKey(document.seriesCode, document.denominationCode);
      if (entries.containsKey(key)) {
        throw const BundleValidationException(
          'Currency catalog contains a duplicate series-denomination pair.',
        );
      }

      final identity = _SeriesIdentity.fromDocument(document);
      final existingIdentity = series[document.seriesCode];
      if (existingIdentity != null && existingIdentity != identity) {
        throw const BundleValidationException(
          'Currency catalog contains inconsistent series metadata.',
        );
      }
      final existingSeriesAtOrder = seriesOrders[document.seriesOrder];
      if (existingSeriesAtOrder != null &&
          existingSeriesAtOrder != document.seriesCode) {
        throw const BundleValidationException(
          'Currency catalog contains a duplicate series order.',
        );
      }
      if (catalogVersion != null && catalogVersion != document.catalogVersion) {
        throw const BundleValidationException(
          'Currency catalog contains inconsistent catalog versions.',
        );
      }
      series[document.seriesCode] = identity;
      seriesOrders[document.seriesOrder] = document.seriesCode;
      catalogVersion = document.catalogVersion;

      final usedOrders = denominationOrders.putIfAbsent(
        document.seriesCode,
        () => <int>{},
      );
      if (!usedOrders.add(document.denominationOrder)) {
        throw const BundleValidationException(
          'Currency catalog contains a duplicate denomination order.',
        );
      }
      entries[key] = document;
    }

    if (entries.isEmpty) {
      throw const BundleValidationException(
        'Currency catalog cannot be empty.',
      );
    }
    return CurrencyCatalogLookup._(entries);
  }

  final Map<String, CurrencyContentDocument> _entries;

  CurrencyContentDocument _find(String seriesCode, String denominationCode) {
    final entry = _entries[_catalogKey(seriesCode, denominationCode)];
    if (entry == null) {
      throw const BundleValidationException(
        'Published currency series and denomination are not in the frozen catalog.',
      );
    }
    return entry;
  }
}

final class _SeriesIdentity {
  const _SeriesIdentity({
    required this.kind,
    required this.name,
    required this.order,
    required this.catalogVersion,
    required this.sourceUrl,
  });

  factory _SeriesIdentity.fromDocument(CurrencyContentDocument document) {
    return _SeriesIdentity(
      kind: document.kind,
      name: document.seriesName,
      order: document.seriesOrder,
      catalogVersion: document.catalogVersion,
      sourceUrl: document.sourceUrl,
    );
  }

  final CurrencyContentKind kind;
  final String name;
  final int order;
  final String catalogVersion;
  final Uri sourceUrl;

  @override
  bool operator ==(Object other) {
    return other is _SeriesIdentity &&
        other.kind == kind &&
        other.name == name &&
        other.order == order &&
        other.catalogVersion == catalogVersion &&
        other.sourceUrl == sourceUrl;
  }

  @override
  int get hashCode => Object.hash(kind, name, order, catalogVersion, sourceUrl);
}

const _maximumDocumentBytes = 64 * 1024;
final _codePattern = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');
final _digestPattern = RegExp(r'^[0-9a-f]{64}$');
final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);
final _internalRoutePattern = RegExp(
  r'^/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$',
);
final _htmlPattern = RegExp(
  r'<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>|<\?[\s\S]*?\?>',
);

String _catalogKey(String seriesCode, String denominationCode) {
  return '$seriesCode\u0000$denominationCode';
}

void _requireSchemaVersion(Object? value) {
  if (value is! int || value != 1) {
    throw const BundleValidationException(
      'Currency document schemaVersion must be 1.',
    );
  }
}

CurrencyContentKind _seedKind(String value) {
  return switch (value) {
    'banknote' => CurrencyContentKind.banknote,
    'coin' => CurrencyContentKind.coin,
    _ => throw const BundleValidationException(
      'Currency seed contentType is not supported.',
    ),
  };
}

CurrencyContentKind _publishedKind(String value) {
  return switch (value) {
    'banknote' => CurrencyContentKind.banknote,
    'coin' => CurrencyContentKind.coin,
    'security_feature' => CurrencyContentKind.securityFeature,
    _ => throw const BundleValidationException(
      'Published content is not a currency document.',
    ),
  };
}

void _requireSeriesKind(String seriesCode, CurrencyContentKind kind) {
  const seriesKinds = {
    'fpp-banknotes': CurrencyContentKind.banknote,
    'engc-banknotes': CurrencyContentKind.banknote,
    'ngc-banknotes': CurrencyContentKind.banknote,
    'ngc-coins': CurrencyContentKind.coin,
    'bsp-coin-series': CurrencyContentKind.coin,
  };
  if (seriesKinds[seriesCode] != kind) {
    throw const BundleValidationException(
      'Currency seed series and content type do not match.',
    );
  }
}

String _string(Map<String, Object?> json, String key, {required int maximum}) {
  final value = json[key];
  if (value is! String ||
      value.isEmpty ||
      value.length > maximum ||
      value != value.trim()) {
    throw BundleValidationException('Currency document $key is invalid.');
  }
  return value;
}

String _plainText(
  Map<String, Object?> json,
  String key, {
  required int maximum,
}) {
  final value = _string(json, key, maximum: maximum);
  if (_htmlPattern.hasMatch(value)) {
    throw BundleValidationException(
      'Currency document $key must be plain text.',
    );
  }
  return value;
}

String? _nullablePlainText(
  Map<String, Object?> json,
  String key, {
  required int maximum,
}) {
  if (!json.containsKey(key)) return null;
  return _plainText(json, key, maximum: maximum);
}

String _code(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 64);
  if (!_codePattern.hasMatch(value)) {
    throw BundleValidationException('Currency document $key is invalid.');
  }
  return value;
}

String _uuid(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 36);
  if (!_uuidPattern.hasMatch(value)) {
    throw BundleValidationException('Currency document $key is invalid.');
  }
  return value;
}

String? _nullableDigest(Map<String, Object?> json, String key) {
  if (!json.containsKey(key)) return null;
  final value = _string(json, key, maximum: 64);
  if (!_digestPattern.hasMatch(value)) {
    throw BundleValidationException('Currency document $key is invalid.');
  }
  return value;
}

int _nonNegativeInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int || value < 0) {
    throw BundleValidationException('Currency document $key is invalid.');
  }
  return value;
}

int _positiveInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int || value <= 0) {
    throw BundleValidationException('Currency document $key is invalid.');
  }
  return value;
}

Uri _bspUrl(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 2048);
  final uri = Uri.tryParse(value);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host != 'www.bsp.gov.ph' ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      !uri.hasAuthority ||
      !value.startsWith('https://www.bsp.gov.ph/')) {
    throw BundleValidationException(
      'Currency document $key must be a BSP HTTPS URL.',
    );
  }
  return uri;
}

List<CurrencyRelatedLink> _seedRelatedLinks(Object? value) {
  if (value is! List<Object?> || value.length > 10) {
    throw const BundleValidationException(
      'Currency seed relatedLinks is invalid.',
    );
  }
  final links = <CurrencyRelatedLink>[];
  final urls = <String>{};
  for (final item in value) {
    if (item is! Map<String, Object?>) {
      throw const BundleValidationException(
        'Currency seed related link is invalid.',
      );
    }
    requireExactJsonKeys(item, const {
      'label',
      'url',
    }, context: 'currency seed related link');
    final link = CurrencyRelatedLink._(
      kind: CurrencyRelatedLinkKind.external,
      label: _plainText(item, 'label', maximum: 100),
      id: null,
      position: null,
      url: _bspUrl(item, 'url'),
      route: null,
      targetContentItemId: null,
    );
    if (!urls.add(link.url.toString())) {
      throw const BundleValidationException(
        'Currency seed contains a duplicate related link.',
      );
    }
    links.add(link);
  }
  return List.unmodifiable(links);
}

List<CurrencyRelatedLink> _publishedRelatedLinks(Object? value) {
  if (value is! List<Object?> || value.length > 10) {
    throw const BundleValidationException(
      'Published currency relatedLinks is invalid.',
    );
  }
  final links = <CurrencyRelatedLink>[];
  final ids = <String>{};
  final positions = <int>{};
  for (final item in value) {
    if (item is! Map<String, Object?>) {
      throw const BundleValidationException(
        'Published currency related link is invalid.',
      );
    }
    final kind = _string(item, 'kind', maximum: 16);
    final id = _uuid(item, 'id');
    final position = _nonNegativeInt(item, 'position');
    final label = _plainText(item, 'label', maximum: 100);
    final link = switch (kind) {
      'external' => () {
        requireExactJsonKeys(item, const {
          'id',
          'position',
          'kind',
          'label',
          'url',
        }, context: 'published external currency related link');
        return CurrencyRelatedLink._(
          kind: CurrencyRelatedLinkKind.external,
          label: label,
          id: id,
          position: position,
          url: _bspUrl(item, 'url'),
          route: null,
          targetContentItemId: null,
        );
      }(),
      'internal' => () {
        requireExactJsonKeys(item, const {
          'id',
          'position',
          'kind',
          'label',
          'route',
        }, context: 'published internal currency related link');
        return CurrencyRelatedLink._(
          kind: CurrencyRelatedLinkKind.internal,
          label: label,
          id: id,
          position: position,
          url: null,
          route: _internalRoute(item, 'route'),
          targetContentItemId: null,
        );
      }(),
      'topic' => () {
        requireExactJsonKeys(item, const {
          'id',
          'position',
          'kind',
          'label',
          'targetContentItemId',
        }, context: 'published topic currency related link');
        return CurrencyRelatedLink._(
          kind: CurrencyRelatedLinkKind.topic,
          label: label,
          id: id,
          position: position,
          url: null,
          route: null,
          targetContentItemId: _uuid(item, 'targetContentItemId'),
        );
      }(),
      _ => throw const BundleValidationException(
        'Published currency related link kind is not supported.',
      ),
    };
    if (!ids.add(id) || !positions.add(position)) {
      throw const BundleValidationException(
        'Published currency contains a duplicate related link.',
      );
    }
    links.add(link);
  }
  return List.unmodifiable(links);
}

String _internalRoute(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 512);
  if (!_internalRoutePattern.hasMatch(value)) {
    throw BundleValidationException(
      'Currency document $key must be a safe internal route.',
    );
  }
  return value;
}
