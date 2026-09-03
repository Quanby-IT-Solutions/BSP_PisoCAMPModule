import 'dart:typed_data';

import 'bundle_protocol.dart';

/// AR-3. One published AR experience, as the bundle carries it.
///
/// The transcript travels with the experience rather than being fetched when
/// the audio plays, because it is the caption: a device with the sound off, or
/// somebody who cannot hear it, still has to be able to read what the narration
/// says, and that has to work offline like everything else here.
final class ArExperienceDocument {
  const ArExperienceDocument._({
    required this.logicalId,
    required this.contentItemId,
    required this.title,
    required this.summary,
    required this.seriesCode,
    required this.denominationCode,
    required this.animationDuration,
    required this.narrationTranscript,
    required this.minimumAndroidSdk,
    required this.minimumIosVersion,
  });

  final String logicalId;
  final String contentItemId;
  final String title;
  final String summary;
  final String seriesCode;
  final String denominationCode;
  final Duration animationDuration;

  /// What the narration says, word for word.
  final String narrationTranscript;

  final int? minimumAndroidSdk;
  final String? minimumIosVersion;

  /// How this experience is named among the mandatory items.
  String get denominationKey => '$seriesCode/$denominationCode';

  /// Reads one published AR experience, or throws if the bytes are anything
  /// else — including a currency document, which has its own parser.
  static ArExperienceDocument parsePublished(Uint8List bytes) {
    final json = decodeStrictJsonObject(
      bytes,
      maximumBytes: bytes.length,
      context: 'published AR experience',
    );
    if (json['contentType'] != 'ar_experience') {
      throw const BundleValidationException(
        'Published content is not an AR experience.',
      );
    }
    if (json['schemaVersion'] != 1) {
      throw const BundleValidationException(
        'Published AR experience schema version is unsupported.',
      );
    }

    final animationDurationMs = json['animationDurationMs'];
    final transcript = json['narrationTranscript'];
    final requirement = json['deviceRequirement'];
    if (animationDurationMs is! int ||
        animationDurationMs < 1000 ||
        animationDurationMs > 300000) {
      throw const BundleValidationException(
        'Published AR experience animation length is out of range.',
      );
    }
    if (transcript is! String ||
        transcript.isEmpty ||
        transcript.length > 4000) {
      // An experience whose narration nobody can read is one a deaf visitor
      // cannot use, so it is refused rather than shown without captions.
      throw const BundleValidationException(
        'Published AR experience is missing its narration transcript.',
      );
    }
    if (requirement is! Map<String, Object?>) {
      throw const BundleValidationException(
        'Published AR experience is missing its device requirement.',
      );
    }
    final androidSdk = requirement['minimumAndroidSdk'];
    final iosVersion = requirement['minimumIosVersion'];
    if ((androidSdk != null && androidSdk is! int) ||
        (iosVersion != null && iosVersion is! String)) {
      throw const BundleValidationException(
        'Published AR experience device requirement is malformed.',
      );
    }

    return ArExperienceDocument._(
      logicalId: _string(json, 'logicalId', 160),
      contentItemId: _string(json, 'contentItemId', 36),
      title: _string(json, 'title', 160),
      summary: _string(json, 'summary', 400),
      seriesCode: _string(json, 'seriesCode', 64),
      denominationCode: _string(json, 'denominationCode', 64),
      animationDuration: Duration(milliseconds: animationDurationMs),
      narrationTranscript: transcript,
      minimumAndroidSdk: androidSdk as int?,
      minimumIosVersion: iosVersion as String?,
    );
  }

  /// The same, but returning null instead of throwing.
  ///
  /// A bundle carries every kind of document; a reader looking for AR
  /// experiences should skip the others rather than fail on them.
  static ArExperienceDocument? tryParsePublished(Uint8List bytes) {
    try {
      return parsePublished(bytes);
    } on Object {
      return null;
    }
  }
}

String _string(Map<String, Object?> json, String key, int maximum) {
  final value = json[key];
  if (value is! String || value.isEmpty || value.length > maximum) {
    throw BundleValidationException(
      'Published AR experience $key is invalid.',
    );
  }
  return value;
}

/// The manifest entries an AR experience needs on the device before it can be
/// opened offline.
///
/// Matched by logical id prefix, which is how CE-1 names an item's assets. An
/// experience with no on-demand assets is one whose files already travel in the
/// core bundle, and it is ready by definition.
List<BundleManifestEntry> arExperienceAssets(
  ArExperienceDocument experience,
  List<BundleManifestEntry> entries,
) {
  final prefix = 'asset.${experience.contentItemId}';
  return entries
      .where(
        (entry) =>
            entry.delivery == BundleEntryDelivery.onDemand &&
            entry.logicalId.startsWith(prefix),
      )
      .toList(growable: false);
}
