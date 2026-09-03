import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;
import 'package:cryptography/cryptography.dart';

const _maximumManifestEntries = 2000;
const _maximumCoreEntryBytes = 5242880;
const _maximumTotalCoreBytes = 52428800;
const _maximumManifestPayloadBytes = 2097152;
const _maximumEnvelopeBytes = 3000000;
const _maximumNetworkKeyConfigurationBytes = 16384;
const _isProductBuild = bool.fromEnvironment('dart.vm.product');
const _debugNetworkPublicKeyBase64url = String.fromEnvironment(
  'PISOCAMP_BUNDLE_DEBUG_PUBLIC_KEY_BASE64URL',
);
const _productionNetworkPublicKeysJson = String.fromEnvironment(
  'PISOCAMP_BUNDLE_PRODUCTION_PUBLIC_KEYS_JSON',
);

final _sha256Pattern = RegExp(r'^[a-f0-9]{64}$');
final _logicalIdPattern = RegExp(r'^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$');
final _keyIdPattern = RegExp(r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$');
final _bundleVersionPattern = RegExp(r'^(?:0|[1-9][0-9]*)$');
final _uuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
);
final _utcTimestampPattern = RegExp(
  r'^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?Z$',
);

final class BundleValidationException implements Exception {
  const BundleValidationException(this.message);

  final String message;

  @override
  String toString() => 'BundleValidationException: $message';
}

final class BundleConfigurationException implements Exception {
  const BundleConfigurationException(this.message);

  final String message;

  @override
  String toString() => 'BundleConfigurationException: $message';
}

/// How a client is to read an entry's bytes.
///
/// `model` is CE-2's glTF geometry; `recognitionModel` is DR-1's classifier and
/// its class descriptor. Two kinds rather than one, because a device that
/// confused them would hand a neural network to a 3D renderer.
enum BundleEntryKind { content, image, model, recognitionModel }

enum BundleEntryDelivery { core, onDemand }

enum BundleVersionDecision { unchanged, update }

final class BundleHighWaterMark {
  const BundleHighWaterMark({
    required this.version,
    required this.manifestDigest,
  });

  final String version;
  final String manifestDigest;

  BundleVersionDecision evaluate({
    required String version,
    required String manifestDigest,
  }) {
    _requireBundleVersion(this.version, 'stored bundleVersion');
    _requireDigest(this.manifestDigest, 'stored manifest digest');
    _requireBundleVersion(version, 'candidate bundleVersion');
    _requireDigest(manifestDigest, 'candidate manifest digest');

    final comparison = BigInt.parse(
      version,
    ).compareTo(BigInt.parse(this.version));
    if (comparison < 0) {
      throw const BundleValidationException(
        'A bundle cannot roll back the accepted version.',
      );
    }
    if (comparison == 0) {
      if (manifestDigest != this.manifestDigest) {
        throw const BundleValidationException(
          'An accepted bundle version cannot change its manifest digest.',
        );
      }
      return BundleVersionDecision.unchanged;
    }
    return BundleVersionDecision.update;
  }
}

final class BundleKeyRing {
  BundleKeyRing._(Map<String, Uint8List> publicKeys)
    : _publicKeys = Map.unmodifiable(publicKeys);

  factory BundleKeyRing.forTests(Map<String, String> publicKeys) {
    _requireNonProductTestFactory();
    if (publicKeys.isEmpty ||
        publicKeys.keys.any((keyId) => !keyId.startsWith('ce1-test-'))) {
      throw const BundleConfigurationException(
        'The test key ring only accepts explicitly labelled CE-1 test keys.',
      );
    }
    return BundleKeyRing._(_decodeConfiguredKeys(publicKeys));
  }

  factory BundleKeyRing.packagedSeed() {
    return BundleKeyRing._({
      'ce5-seed-v4': _decodeHex(
        '0907bf1736e9ac26b31e034abdc1148a197241226df1aa583b76aa735be7404f',
      ),
    });
  }

  factory BundleKeyRing.forCurrentBuild() {
    return _fromBuildConfiguration(
      isProduct: _isProductBuild,
      debugPublicKeyBase64url: _debugNetworkPublicKeyBase64url,
      productionPublicKeysJson: _productionNetworkPublicKeysJson,
    );
  }

  factory BundleKeyRing.fromBuildConfigurationForTests({
    required bool isProduct,
    String debugPublicKeyBase64url = '',
    String productionPublicKeysJson = '',
  }) {
    _requireNonProductTestFactory();
    return _fromBuildConfiguration(
      isProduct: isProduct,
      debugPublicKeyBase64url: debugPublicKeyBase64url,
      productionPublicKeysJson: productionPublicKeysJson,
    );
  }

  static BundleKeyRing _fromBuildConfiguration({
    required bool isProduct,
    required String debugPublicKeyBase64url,
    required String productionPublicKeysJson,
  }) {
    if (!isProduct) {
      if (debugPublicKeyBase64url.isEmpty) {
        throw const BundleConfigurationException(
          'Network debug verification requires its compile-time public key.',
        );
      }
      return BundleKeyRing._({
        'ce1-dev-2026-01': _decodePublicKey(debugPublicKeyBase64url),
      });
    }

    final productionPublicKeys = _decodeProductionKeyConfiguration(
      productionPublicKeysJson,
    );
    if (productionPublicKeys.isEmpty ||
        productionPublicKeys.keys.any(
          (keyId) => !keyId.startsWith('ce1-prod-'),
        )) {
      throw const BundleConfigurationException(
        'Network release verification requires production-only public keys.',
      );
    }
    return BundleKeyRing._(_decodeConfiguredKeys(productionPublicKeys));
  }

  final Map<String, Uint8List> _publicKeys;

  bool accepts(String keyId) => _publicKeys.containsKey(keyId);

  Uint8List? _keyFor(String keyId) => _publicKeys[keyId];
}

final class BundleEnvelope {
  BundleEnvelope._({
    required this.schemaVersion,
    required this.algorithm,
    required this.keyId,
    required Uint8List payload,
    required Uint8List signature,
    required this.payloadSha256,
    required this.manifest,
  }) : _payload = Uint8List.fromList(payload),
       _signature = Uint8List.fromList(signature);

  final int schemaVersion;
  final String algorithm;
  final String keyId;
  final Uint8List _payload;
  final Uint8List _signature;
  final String payloadSha256;
  final BundleManifest manifest;

  Uint8List get payload => Uint8List.fromList(_payload);

  Uint8List get signature => Uint8List.fromList(_signature);

  static Future<BundleEnvelope> parseAndVerify(
    Uint8List bytes,
    BundleKeyRing keyRing,
  ) async {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumEnvelopeBytes,
      context: 'bundle envelope',
    );
    requireExactJsonKeys(json, const {
      'schemaVersion',
      'algorithm',
      'keyId',
      'payload',
      'signature',
    }, context: 'bundle envelope');

    if (json['schemaVersion'] is! int || json['schemaVersion'] != 1) {
      throw const BundleValidationException(
        'Bundle envelope schemaVersion must be 1.',
      );
    }
    if (json['algorithm'] != 'Ed25519') {
      throw const BundleValidationException(
        'Bundle envelope algorithm must be Ed25519.',
      );
    }
    final keyId = _boundedString(json['keyId'], maximum: 64, field: 'keyId');
    if (!_keyIdPattern.hasMatch(keyId)) {
      throw const BundleValidationException(
        'Bundle envelope keyId is invalid.',
      );
    }
    final publicKey = keyRing._keyFor(keyId);
    if (publicKey == null) {
      throw const BundleValidationException(
        'Bundle envelope keyId is not trusted for this purpose.',
      );
    }

    final payload = _decodeCanonicalBase64url(
      json['payload'],
      maximumDecodedBytes: _maximumManifestPayloadBytes,
      field: 'payload',
    );
    final signature = _decodeCanonicalBase64url(
      json['signature'],
      maximumDecodedBytes: 64,
      field: 'signature',
    );
    if (signature.length != 64) {
      throw const BundleValidationException(
        'Ed25519 signatures must contain exactly 64 bytes.',
      );
    }

    bool verified;
    try {
      verified = await Ed25519().verify(
        payload,
        signature: Signature(
          signature,
          publicKey: SimplePublicKey(publicKey, type: KeyPairType.ed25519),
        ),
      );
    } on Object {
      throw const BundleValidationException(
        'Bundle envelope signature could not be verified.',
      );
    }
    if (!verified) {
      throw const BundleValidationException(
        'Bundle envelope signature is invalid.',
      );
    }

    final manifest = BundleManifest._parse(payload);
    return BundleEnvelope._(
      schemaVersion: 1,
      algorithm: 'Ed25519',
      keyId: keyId,
      payload: payload,
      signature: signature,
      payloadSha256: hashes.sha256.convert(payload).toString(),
      manifest: manifest,
    );
  }
}

final class BundleManifest {
  BundleManifest._({
    required this.schemaVersion,
    required this.bundleVersion,
    required this.generatedAt,
    required this.minimumClientSchemaVersion,
    required List<BundleManifestEntry> entries,
  }) : entries = List.unmodifiable(entries) {
    _validateEntries(this.entries);
  }

  factory BundleManifest.forTest({
    String bundleVersion = '0',
    DateTime? generatedAt,
    List<BundleManifestEntry> entries = const [],
  }) {
    _requireBundleVersion(bundleVersion, 'bundleVersion');
    return BundleManifest._(
      schemaVersion: 1,
      bundleVersion: bundleVersion,
      generatedAt: generatedAt ?? DateTime.utc(2026, 8, 27),
      minimumClientSchemaVersion: 1,
      entries: entries,
    );
  }

  final int schemaVersion;
  final String bundleVersion;
  final DateTime generatedAt;
  final int minimumClientSchemaVersion;
  final List<BundleManifestEntry> entries;

  static BundleManifest _parse(Uint8List bytes) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumManifestPayloadBytes,
      context: 'bundle manifest',
    );
    requireExactJsonKeys(json, const {
      'schemaVersion',
      'bundleVersion',
      'generatedAt',
      'minimumClientSchemaVersion',
      'entries',
    }, context: 'bundle manifest');
    if (json['schemaVersion'] is! int || json['schemaVersion'] != 1) {
      throw const BundleValidationException(
        'Bundle manifest schemaVersion must be 1.',
      );
    }
    if (json['minimumClientSchemaVersion'] is! int ||
        json['minimumClientSchemaVersion'] != 1) {
      throw const BundleValidationException(
        'Bundle manifest minimumClientSchemaVersion must be 1.',
      );
    }
    final bundleVersion = _boundedString(
      json['bundleVersion'],
      maximum: 256,
      field: 'bundleVersion',
    );
    _requireBundleVersion(bundleVersion, 'bundleVersion');
    final generatedAt = _parseUtcTimestamp(json['generatedAt']);
    final rawEntries = json['entries'];
    if (rawEntries is! List<Object?> ||
        rawEntries.length > _maximumManifestEntries) {
      throw const BundleValidationException(
        'Bundle manifest entries are invalid or exceed the count limit.',
      );
    }
    final entries = <BundleManifestEntry>[];
    for (final rawEntry in rawEntries) {
      if (rawEntry is! Map<String, Object?>) {
        throw const BundleValidationException(
          'Every bundle manifest entry must be an object.',
        );
      }
      entries.add(BundleManifestEntry._parse(rawEntry));
    }
    return BundleManifest._(
      schemaVersion: 1,
      bundleVersion: bundleVersion,
      generatedAt: generatedAt,
      minimumClientSchemaVersion: 1,
      entries: entries,
    );
  }

  static void _validateEntries(List<BundleManifestEntry> entries) {
    if (entries.length > _maximumManifestEntries) {
      throw const BundleValidationException(
        'Bundle manifest exceeds the entry count limit.',
      );
    }
    var totalCoreBytes = 0;
    String? previousLogicalId;
    for (final entry in entries) {
      if (previousLogicalId != null &&
          previousLogicalId.compareTo(entry.logicalId) >= 0) {
        throw const BundleValidationException(
          'Bundle entries must be strictly sorted by unique logicalId.',
        );
      }
      if (entry.delivery == BundleEntryDelivery.core) {
        totalCoreBytes += entry.byteLength;
        if (totalCoreBytes > _maximumTotalCoreBytes) {
          throw const BundleValidationException(
            'Bundle core resources exceed the total byte limit.',
          );
        }
      }
      previousLogicalId = entry.logicalId;
    }
  }
}

const _notProvided = Object();

final class BundleManifestEntry {
  BundleManifestEntry._({
    required this.logicalId,
    required this.kind,
    required this.delivery,
    required this.mediaType,
    required this.byteLength,
    required this.sha256,
    required this.downloadPath,
    required this.contentItemId,
    required this.contentVersionId,
  }) {
    _validate();
  }

  factory BundleManifestEntry.forTest({
    required String logicalId,
    required BundleEntryKind kind,
    required String mediaType,
    required Uint8List bytes,
    BundleEntryDelivery delivery = BundleEntryDelivery.core,
    String? contentItemId,
    String? contentVersionId,
  }) {
    final digest = hashes.sha256.convert(bytes).toString();
    return BundleManifestEntry._(
      logicalId: logicalId,
      kind: kind,
      delivery: delivery,
      mediaType: mediaType,
      byteLength: bytes.length,
      sha256: digest,
      downloadPath: '/pisocamp/bundle/resources/$digest',
      contentItemId: contentItemId,
      contentVersionId: contentVersionId,
    );
  }

  final String logicalId;
  final BundleEntryKind kind;
  final BundleEntryDelivery delivery;
  final String mediaType;
  final int byteLength;
  final String sha256;
  final String downloadPath;
  final String? contentItemId;
  final String? contentVersionId;

  BundleManifestEntry copyWith({
    String? logicalId,
    BundleEntryKind? kind,
    BundleEntryDelivery? delivery,
    String? mediaType,
    int? byteLength,
    String? sha256,
    String? downloadPath,
    Object? contentItemId = _notProvided,
    Object? contentVersionId = _notProvided,
  }) {
    return BundleManifestEntry._(
      logicalId: logicalId ?? this.logicalId,
      kind: kind ?? this.kind,
      delivery: delivery ?? this.delivery,
      mediaType: mediaType ?? this.mediaType,
      byteLength: byteLength ?? this.byteLength,
      sha256: sha256 ?? this.sha256,
      downloadPath: downloadPath ?? this.downloadPath,
      contentItemId: identical(contentItemId, _notProvided)
          ? this.contentItemId
          : contentItemId as String?,
      contentVersionId: identical(contentVersionId, _notProvided)
          ? this.contentVersionId
          : contentVersionId as String?,
    );
  }

  Future<void> validateResource(Uint8List bytes) async {
    if (bytes.length != byteLength) {
      throw const BundleValidationException(
        'Resource length does not match its manifest entry.',
      );
    }
    if (hashes.sha256.convert(bytes).toString() != sha256) {
      throw const BundleValidationException(
        'Resource digest does not match its manifest entry.',
      );
    }

    if (kind == BundleEntryKind.content) {
      decodeStrictJsonObject(
        bytes,
        maximumBytes: byteLength,
        context: 'bundle JSON resource',
      );
      return;
    }
    if (kind == BundleEntryKind.recognitionModel) {
      // The descriptor has to be readable JSON; the weights are opaque, and
      // their digest — already checked above — is the whole guarantee there is
      // to give about them.
      if (mediaType == 'application/json') {
        decodeStrictJsonObject(
          bytes,
          maximumBytes: byteLength,
          context: 'recognition model descriptor',
        );
      }
      return;
    }
    if (kind == BundleEntryKind.model) {
      if (!_isBinaryGltf(bytes)) {
        throw const BundleValidationException(
          'Model bytes are not a self-consistent binary glTF 2.0 document.',
        );
      }
      return;
    }
    final hasExpectedMagic = switch (mediaType) {
      'image/png' => _startsWith(bytes, const [
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
      ]),
      'image/jpeg' => _startsWith(bytes, const [255, 216, 255]),
      'image/webp' =>
        _startsWith(bytes, const [82, 73, 70, 70]) &&
            bytes.length >= 12 &&
            _matchesAt(bytes, 8, const [87, 69, 66, 80]),
      _ => false,
    };
    if (!hasExpectedMagic) {
      throw const BundleValidationException(
        'Image bytes do not match the declared media type.',
      );
    }
  }

  /// Binary glTF header check: `glTF` magic, container version 2, and a
  /// declared total length that matches the bytes actually held. The declared
  /// length is what a reader would trust when walking chunks, so a mismatch is
  /// rejected before any parser sees it.
  static bool _isBinaryGltf(Uint8List bytes) {
    if (bytes.length < 12 ||
        !_startsWith(bytes, const [0x67, 0x6c, 0x54, 0x46])) {
      return false;
    }
    final header = ByteData.sublistView(bytes, 0, 12);
    return header.getUint32(4, Endian.little) == 2 &&
        header.getUint32(8, Endian.little) == bytes.length;
  }

  static BundleManifestEntry _parse(Map<String, Object?> json) {
    requireExactJsonKeys(
      json,
      const {
        'logicalId',
        'kind',
        'delivery',
        'mediaType',
        'byteLength',
        'sha256',
        'downloadPath',
      },
      optionalKeys: const {'contentItemId', 'contentVersionId'},
      context: 'bundle manifest entry',
    );
    final kindValue = json['kind'];
    final kind = switch (kindValue) {
      'content' => BundleEntryKind.content,
      'image' => BundleEntryKind.image,
      'model' => BundleEntryKind.model,
      'recognition_model' => BundleEntryKind.recognitionModel,
      _ => throw const BundleValidationException(
        'Bundle manifest entry kind is unsupported.',
      ),
    };
    final delivery = switch (json['delivery']) {
      'core' => BundleEntryDelivery.core,
      'on_demand' => BundleEntryDelivery.onDemand,
      _ => throw const BundleValidationException(
        'Bundle manifest entry delivery is unsupported.',
      ),
    };
    return BundleManifestEntry._(
      logicalId: _boundedString(
        json['logicalId'],
        maximum: 160,
        field: 'logicalId',
      ),
      kind: kind,
      delivery: delivery,
      mediaType: _boundedString(
        json['mediaType'],
        maximum: 32,
        field: 'mediaType',
      ),
      byteLength: _positiveInteger(json['byteLength'], 'byteLength'),
      sha256: _boundedString(json['sha256'], maximum: 64, field: 'sha256'),
      downloadPath: _boundedString(
        json['downloadPath'],
        maximum: 256,
        field: 'downloadPath',
      ),
      contentItemId: _optionalString(json, 'contentItemId', 36),
      contentVersionId: _optionalString(json, 'contentVersionId', 36),
    );
  }

  void _validate() {
    if (logicalId.isEmpty ||
        logicalId.length > 160 ||
        !_logicalIdPattern.hasMatch(logicalId)) {
      throw const BundleValidationException(
        'Bundle manifest entry logicalId is invalid.',
      );
    }
    // A kind names how a client renders the bytes, so the two can never
    // disagree: a model entry claiming PNG would reach an image decoder.
    const mediaTypesByKind = <BundleEntryKind, Set<String>>{
      BundleEntryKind.content: {'application/json'},
      BundleEntryKind.image: {'image/png', 'image/jpeg', 'image/webp'},
      BundleEntryKind.model: {'model/gltf-binary'},
      BundleEntryKind.recognitionModel: {
        'application/json',
        'application/octet-stream',
      },
    };
    if (!(mediaTypesByKind[kind] ?? const <String>{}).contains(mediaType)) {
      throw const BundleValidationException(
        'Bundle manifest entry media type does not match its kind.',
      );
    }
    if (byteLength <= 0 ||
        (delivery == BundleEntryDelivery.core &&
            byteLength > _maximumCoreEntryBytes)) {
      throw const BundleValidationException(
        'Bundle manifest entry byteLength is outside its delivery limit.',
      );
    }
    _requireDigest(sha256, 'entry sha256');
    if (downloadPath != '/pisocamp/bundle/resources/$sha256') {
      throw const BundleValidationException(
        'Bundle resource path must be the digest-addressed public route.',
      );
    }
    if ((contentItemId == null) != (contentVersionId == null)) {
      throw const BundleValidationException(
        'Bundle content ownership identifiers must be present together.',
      );
    }
    if ((contentItemId != null && !_uuidPattern.hasMatch(contentItemId!)) ||
        (contentVersionId != null &&
            !_uuidPattern.hasMatch(contentVersionId!))) {
      throw const BundleValidationException(
        'Bundle content ownership identifiers must be UUIDs.',
      );
    }
  }
}

Map<String, Object?> decodeStrictJsonObject(
  Uint8List bytes, {
  required int maximumBytes,
  required String context,
}) {
  if (bytes.isEmpty || maximumBytes < 1 || bytes.length > maximumBytes) {
    throw BundleValidationException('$context exceeds its byte limit.');
  }
  try {
    final source = utf8.decode(bytes, allowMalformed: false);
    _StrictJsonScanner(source, context).scan();
    final decoded = jsonDecode(source);
    if (decoded is! Map<String, Object?>) {
      throw BundleValidationException('$context must be a JSON object.');
    }
    return decoded;
  } on BundleValidationException {
    rethrow;
  } on Object {
    throw BundleValidationException('$context is not valid strict JSON.');
  }
}

void requireExactJsonKeys(
  Map<String, Object?> json,
  Set<String> requiredKeys, {
  Set<String> optionalKeys = const {},
  required String context,
}) {
  final allowedKeys = {...requiredKeys, ...optionalKeys};
  if (!json.keys.toSet().containsAll(requiredKeys) ||
      json.keys.any((key) => !allowedKeys.contains(key))) {
    throw BundleValidationException('$context has missing or unknown fields.');
  }
}

void _requireNonProductTestFactory() {
  if (_isProductBuild) {
    throw const BundleConfigurationException(
      'Test bundle key injection is disabled in product builds.',
    );
  }
}

Map<String, String> _decodeProductionKeyConfiguration(String encoded) {
  if (encoded.isEmpty) {
    throw const BundleConfigurationException(
      'The production network public-key configuration is absent.',
    );
  }
  try {
    final json = decodeStrictJsonObject(
      Uint8List.fromList(utf8.encode(encoded)),
      maximumBytes: _maximumNetworkKeyConfigurationBytes,
      context: 'production network public-key configuration',
    );
    final keys = <String, String>{};
    for (final entry in json.entries) {
      final value = entry.value;
      if (value is! String || value.isEmpty) {
        throw const BundleConfigurationException(
          'Every production network public key must be a nonempty string.',
        );
      }
      keys[entry.key] = value;
    }
    return keys;
  } on BundleConfigurationException {
    rethrow;
  } on Object {
    throw const BundleConfigurationException(
      'The production network public-key configuration is malformed.',
    );
  }
}

Map<String, Uint8List> _decodeConfiguredKeys(Map<String, String> keys) {
  final result = <String, Uint8List>{};
  for (final entry in keys.entries) {
    if (entry.key.isEmpty ||
        entry.key.length > 64 ||
        !_keyIdPattern.hasMatch(entry.key)) {
      throw const BundleConfigurationException(
        'A configured bundle key ID is invalid.',
      );
    }
    result[entry.key] = _decodePublicKey(entry.value);
  }
  return result;
}

Uint8List _decodePublicKey(String encoded) {
  try {
    if (encoded.startsWith('-----BEGIN PUBLIC KEY-----')) {
      final body = encoded
          .replaceAll('-----BEGIN PUBLIC KEY-----', '')
          .replaceAll('-----END PUBLIC KEY-----', '')
          .replaceAll(RegExp(r'\s'), '');
      final der = base64.decode(body);
      const prefix = <int>[48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0];
      if (der.length != prefix.length + 32 || !_startsWith(der, prefix)) {
        throw const FormatException();
      }
      return Uint8List.fromList(der.sublist(prefix.length));
    }
    final decoded = _decodeCanonicalBase64url(
      encoded,
      maximumDecodedBytes: 32,
      field: 'public key',
    );
    if (decoded.length != 32) throw const FormatException();
    return decoded;
  } on Object {
    throw const BundleConfigurationException(
      'A configured Ed25519 public key is invalid.',
    );
  }
}

Uint8List _decodeCanonicalBase64url(
  Object? value, {
  required int maximumDecodedBytes,
  required String field,
}) {
  if (value is! String ||
      value.isEmpty ||
      !RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(value) ||
      value.length % 4 == 1 ||
      (value.length * 3) ~/ 4 > maximumDecodedBytes) {
    throw BundleValidationException('$field is not canonical base64url.');
  }
  try {
    final decoded = Uint8List.fromList(
      base64Url.decode(base64Url.normalize(value)),
    );
    final canonical = base64Url.encode(decoded).replaceAll('=', '');
    if (decoded.length > maximumDecodedBytes || canonical != value) {
      throw const FormatException();
    }
    return decoded;
  } on Object {
    throw BundleValidationException('$field is not canonical base64url.');
  }
}

Uint8List _decodeHex(String value) {
  return Uint8List.fromList([
    for (var index = 0; index < value.length; index += 2)
      int.parse(value.substring(index, index + 2), radix: 16),
  ]);
}

void _requireBundleVersion(String value, String field) {
  if (!_bundleVersionPattern.hasMatch(value)) {
    throw BundleValidationException(
      '$field is not a canonical decimal version.',
    );
  }
}

void _requireDigest(String value, String field) {
  if (!_sha256Pattern.hasMatch(value)) {
    throw BundleValidationException(
      '$field is not a canonical SHA-256 digest.',
    );
  }
}

String _boundedString(
  Object? value, {
  required int maximum,
  required String field,
}) {
  if (value is! String || value.isEmpty || value.length > maximum) {
    throw BundleValidationException('Bundle $field is invalid.');
  }
  return value;
}

String? _optionalString(Map<String, Object?> json, String key, int maximum) {
  if (!json.containsKey(key)) return null;
  return _boundedString(json[key], maximum: maximum, field: key);
}

int _positiveInteger(Object? value, String field) {
  if (value is! int || value <= 0) {
    throw BundleValidationException(
      'Bundle $field must be a positive integer.',
    );
  }
  return value;
}

DateTime _parseUtcTimestamp(Object? value) {
  if (value is! String) {
    throw const BundleValidationException(
      'Bundle generatedAt must be a UTC timestamp.',
    );
  }
  final match = _utcTimestampPattern.firstMatch(value);
  final parsed = DateTime.tryParse(value);
  if (match == null || parsed == null || !parsed.isUtc) {
    throw const BundleValidationException(
      'Bundle generatedAt must be a valid UTC timestamp.',
    );
  }
  final components = [
    parsed.year,
    parsed.month,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
  ];
  for (var index = 0; index < components.length; index += 1) {
    if (components[index] != int.parse(match.group(index + 1)!)) {
      throw const BundleValidationException(
        'Bundle generatedAt must be a valid UTC timestamp.',
      );
    }
  }
  return parsed;
}

bool _startsWith(List<int> bytes, List<int> prefix) {
  return _matchesAt(bytes, 0, prefix);
}

bool _matchesAt(List<int> bytes, int offset, List<int> expected) {
  if (bytes.length < offset + expected.length) return false;
  for (var index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] != expected[index]) return false;
  }
  return true;
}

final class _StrictJsonScanner {
  _StrictJsonScanner(this.source, this.context);

  final String source;
  final String context;
  var _offset = 0;

  void scan() {
    _skipWhitespace();
    _value();
    _skipWhitespace();
    if (_offset != source.length) _invalid();
  }

  void _value() {
    if (_offset >= source.length) _invalid();
    switch (source.codeUnitAt(_offset)) {
      case 123:
        _object();
      case 91:
        _array();
      case 34:
        _string();
      case 116:
        _literal('true');
      case 102:
        _literal('false');
      case 110:
        _literal('null');
      default:
        _number();
    }
  }

  void _object() {
    _offset += 1;
    _skipWhitespace();
    if (_consume(125)) return;
    final keys = <String>{};
    while (true) {
      if (_offset >= source.length || source.codeUnitAt(_offset) != 34) {
        _invalid();
      }
      final key = _string();
      if (!keys.add(key)) {
        throw BundleValidationException(
          '$context contains a duplicate JSON key.',
        );
      }
      _skipWhitespace();
      if (!_consume(58)) _invalid();
      _skipWhitespace();
      _value();
      _skipWhitespace();
      if (_consume(125)) return;
      if (!_consume(44)) _invalid();
      _skipWhitespace();
    }
  }

  void _array() {
    _offset += 1;
    _skipWhitespace();
    if (_consume(93)) return;
    while (true) {
      _value();
      _skipWhitespace();
      if (_consume(93)) return;
      if (!_consume(44)) _invalid();
      _skipWhitespace();
    }
  }

  String _string() {
    final start = _offset;
    _offset += 1;
    var escaped = false;
    while (_offset < source.length) {
      final codeUnit = source.codeUnitAt(_offset);
      if (!escaped && codeUnit == 34) {
        _offset += 1;
        final decoded = jsonDecode(source.substring(start, _offset));
        if (decoded is! String) _invalid();
        return decoded;
      }
      if (!escaped && codeUnit < 32) _invalid();
      if (!escaped && codeUnit == 92) {
        escaped = true;
      } else {
        escaped = false;
      }
      _offset += 1;
    }
    _invalid();
  }

  void _literal(String literal) {
    if (!source.startsWith(literal, _offset)) _invalid();
    _offset += literal.length;
  }

  void _number() {
    final remainder = source.substring(_offset);
    final match = RegExp(
      r'^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?',
    ).firstMatch(remainder);
    if (match == null) _invalid();
    _offset += match.group(0)!.length;
  }

  void _skipWhitespace() {
    while (_offset < source.length) {
      final codeUnit = source.codeUnitAt(_offset);
      if (codeUnit != 32 && codeUnit != 10 && codeUnit != 13 && codeUnit != 9) {
        return;
      }
      _offset += 1;
    }
  }

  bool _consume(int codeUnit) {
    if (_offset < source.length && source.codeUnitAt(_offset) == codeUnit) {
      _offset += 1;
      return true;
    }
    return false;
  }

  Never _invalid() {
    throw BundleValidationException('$context is not valid strict JSON.');
  }
}
