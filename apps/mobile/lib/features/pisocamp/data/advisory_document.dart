import 'dart:convert';
import 'dart:typed_data';

import 'package:shared_preferences/shared_preferences.dart';

import 'bundle_protocol.dart';

/// Where an advisory offers to send someone next.
enum AdvisoryLinkKind { external, internal, topic }

final class AdvisoryLink {
  const AdvisoryLink({
    required this.kind,
    required this.label,
    required this.destination,
  });

  final AdvisoryLinkKind kind;
  final String label;

  /// A URL, a route, or a content item id, according to [kind].
  final String destination;
}

/// A published advisory, read from the offline bundle.
///
/// The approved words on handling currency properly. It renders from the
/// bundle because a person leaving the module may have no connection, and an
/// advisory nobody can read is not an advisory.
final class AdvisoryDocument {
  AdvisoryDocument._({
    required this.logicalId,
    required this.contentItemId,
    required this.contentVersionId,
    required this.versionNo,
    required this.title,
    required this.summary,
    required this.body,
    required List<AdvisoryLink> links,
  }) : links = List.unmodifiable(links);

  final String logicalId;
  final String contentItemId;
  final String contentVersionId;
  final int versionNo;
  final String title;
  final String summary;

  /// The advisory itself, which is the content item's body.
  final String body;

  final List<AdvisoryLink> links;

  static const _maximumDocumentBytes = 64 * 1024;

  /// Parses a published advisory, or throws [BundleValidationException].
  static AdvisoryDocument parsePublished(Uint8List bytes) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: _maximumDocumentBytes,
      context: 'published advisory',
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
      'featureLevel',
      'hotspot',
      'relatedLinks',
    }, context: 'published advisory');

    if (json['schemaVersion'] != 1) {
      throw const BundleValidationException(
        'Advisory schemaVersion must be 1.',
      );
    }
    if (json['contentType'] != 'advisory') {
      throw const BundleValidationException(
        'Published content is not an advisory.',
      );
    }
    for (final key in const [
      'seriesCode',
      'denominationCode',
      'primaryUrl',
      'featureLevel',
      'hotspot',
    ]) {
      if (json[key] != null) {
        throw BundleValidationException('Advisory $key must be null.');
      }
    }

    final contentItemId = _uuid(json, 'contentItemId');
    final logicalId = _string(json, 'logicalId', maximum: 160);
    if (logicalId != 'content.$contentItemId') {
      throw const BundleValidationException(
        'Advisory logicalId does not match its content item.',
      );
    }

    return AdvisoryDocument._(
      logicalId: logicalId,
      contentItemId: contentItemId,
      contentVersionId: _uuid(json, 'contentVersionId'),
      versionNo: _positiveInt(json, 'versionNo'),
      title: _plainText(json, 'title', maximum: 160),
      summary: _plainText(json, 'summary', maximum: 500),
      body: _plainText(json, 'body', maximum: 10000),
      links: _links(json['relatedLinks']),
    );
  }
}

List<AdvisoryLink> _links(Object? value) {
  if (value is! List<Object?> || value.length > 10) {
    throw const BundleValidationException('Advisory relatedLinks is invalid.');
  }
  final links = <AdvisoryLink>[];
  for (final item in value) {
    if (item is! Map<String, Object?>) {
      throw const BundleValidationException(
        'Advisory related link is invalid.',
      );
    }
    final kind = switch (item['kind']) {
      'external' => AdvisoryLinkKind.external,
      'internal' => AdvisoryLinkKind.internal,
      'topic' => AdvisoryLinkKind.topic,
      _ => throw const BundleValidationException(
        'Advisory related link kind is not supported.',
      ),
    };
    final destinationKey = switch (kind) {
      AdvisoryLinkKind.external => 'url',
      AdvisoryLinkKind.internal => 'route',
      AdvisoryLinkKind.topic => 'targetContentItemId',
    };
    requireExactJsonKeys(item, {
      'id',
      'position',
      'kind',
      'label',
      destinationKey,
    }, context: 'advisory related link');
    final destination = _string(item, destinationKey, maximum: 2048);
    // An external destination is opened in a browser, so http(s) is not a
    // detail to be lenient about.
    if (kind == AdvisoryLinkKind.external &&
        !destination.startsWith('https://')) {
      throw const BundleValidationException('An advisory link must use HTTPS.');
    }
    links.add(
      AdvisoryLink(
        kind: kind,
        label: _plainText(item, 'label', maximum: 100),
        destination: destination,
      ),
    );
  }
  return links;
}

/// When the exit advisory was last shown on this device.
abstract interface class AdvisoryDisplayStore {
  Future<DateTime?> readLastShown();
  Future<void> recordShown(DateTime at);
}

/// Shared preferences: one timestamp, which identifies nobody.
class PreferencesAdvisoryDisplayStore implements AdvisoryDisplayStore {
  PreferencesAdvisoryDisplayStore(this._preferences);

  final SharedPreferences _preferences;

  static const String storageKey = 'pisocamp.advisory.last-shown.v1';

  @override
  Future<DateTime?> readLastShown() async {
    final raw = _preferences.getString(storageKey);
    if (raw == null || raw.isEmpty) return null;
    return DateTime.tryParse(raw)?.toUtc();
  }

  @override
  Future<void> recordShown(DateTime at) =>
      _preferences.setString(storageKey, at.toUtc().toIso8601String());
}

/// Whether the advisory is due, given the configured interval.
///
/// The interval is in hours and the comparison is inclusive: an advisory shown
/// exactly the interval ago is due again. A device that has never shown one is
/// always due.
bool advisoryIsDue({
  required DateTime now,
  required DateTime? lastShown,
  required int intervalHours,
}) {
  if (lastShown == null) return true;
  return !now.toUtc().isBefore(
    lastShown.toUtc().add(Duration(hours: intervalHours)),
  );
}

/// Picks the advisory to show on exit.
///
/// The first by content item id, so a device shows the same one rather than
/// shuffling between visits. Which advisory is "the" exit advisory is a
/// content decision; until one is marked, the module is consistent about it.
AdvisoryDocument? exitAdvisoryFrom(List<AdvisoryDocument> advisories) {
  if (advisories.isEmpty) return null;
  final sorted = [...advisories]
    ..sort((left, right) => left.contentItemId.compareTo(right.contentItemId));
  return sorted.first;
}

final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);
final _htmlPattern = RegExp(
  r'<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>|<\?[\s\S]*?\?>',
);

String _string(Map<String, Object?> json, String key, {required int maximum}) {
  final value = json[key];
  if (value is! String ||
      value.isEmpty ||
      value.length > maximum ||
      value != value.trim()) {
    throw BundleValidationException('Advisory $key is invalid.');
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
    throw BundleValidationException('Advisory $key must be plain text.');
  }
  return value;
}

String _uuid(Map<String, Object?> json, String key) {
  final value = _string(json, key, maximum: 36);
  if (!_uuidPattern.hasMatch(value)) {
    throw BundleValidationException('Advisory $key is invalid.');
  }
  return value;
}

int _positiveInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int || value <= 0) {
    throw BundleValidationException('Advisory $key is invalid.');
  }
  return value;
}

/// Kept for symmetry with the other readers, which all decode their own bytes.
Uint8List advisoryBytesOf(String json) => Uint8List.fromList(utf8.encode(json));
