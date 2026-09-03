import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/ar_experience_document.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';

Map<String, Object?> _document([Map<String, Object?> overrides = const {}]) => {
  'schemaVersion': 1,
  'logicalId': 'content.11111111-1111-4111-8111-111111111111',
  'contentItemId': '11111111-1111-4111-8111-111111111111',
  'contentVersionId': '22222222-2222-4222-8222-222222222222',
  'contentType': 'ar_experience',
  'title': 'The 20-piso coin in your room',
  'summary': 'Place the coin on any flat surface.',
  'animationDurationMs': 12000,
  'narrationTranscript': 'The tamaraw of Mindoro appears on this coin.',
  'deviceRequirement': {'minimumAndroidSdk': 26, 'minimumIosVersion': '13.0'},
  'seriesCode': 'ngc-coins',
  'denominationCode': 'php-20',
  ...overrides,
};

Uint8List _bytes(Map<String, Object?> json) =>
    Uint8List.fromList(utf8.encode(jsonEncode(json)));

void main() {
  group('AR-3 reading a published experience', () {
    test('reads its timeline, its captions and what a device needs', () {
      final document = ArExperienceDocument.parsePublished(_bytes(_document()));

      expect(document.animationDuration, const Duration(seconds: 12));
      expect(
        document.narrationTranscript,
        'The tamaraw of Mindoro appears on this coin.',
      );
      expect(document.denominationKey, 'ngc-coins/php-20');
      expect(document.minimumAndroidSdk, 26);
    });

    test('refuses an experience with no narration to read', () {
      // An experience whose audio nobody can read is one a deaf visitor cannot
      // use, so it is refused rather than shown with an empty caption box.
      for (final transcript in <Object?>[null, '', 'x' * 4001, 42]) {
        expect(
          () => ArExperienceDocument.parsePublished(
            _bytes(_document({'narrationTranscript': transcript})),
          ),
          throwsA(isA<BundleValidationException>()),
          reason: '$transcript',
        );
      }
    });

    test('refuses an animation length outside the approved range', () {
      for (final duration in <Object?>[0, 999, 300001, '12000']) {
        expect(
          () => ArExperienceDocument.parsePublished(
            _bytes(_document({'animationDurationMs': duration})),
          ),
          throwsA(isA<BundleValidationException>()),
          reason: '$duration',
        );
      }
    });

    test('skips a document that is not an AR experience', () {
      // A bundle carries every kind of document; a reader looking for
      // experiences steps over the rest rather than failing on them.
      expect(
        ArExperienceDocument.tryParsePublished(
          _bytes(_document({'contentType': 'coin'})),
        ),
        isNull,
      );
    });
  });

  group('AR-3 which assets an experience needs', () {
    BundleManifestEntry entry(String logicalId, BundleEntryDelivery delivery) =>
        BundleManifestEntry.forTest(
          logicalId: logicalId,
          kind: BundleEntryKind.model,
          mediaType: 'model/gltf-binary',
          bytes: Uint8List.fromList(List<int>.filled(16, 1)),
          delivery: delivery,
        );

    test('takes the on-demand entries that belong to it, and nothing else', () {
      final document = ArExperienceDocument.parsePublished(_bytes(_document()));
      final entries = <BundleManifestEntry>[
        entry('asset.${document.contentItemId}.model', BundleEntryDelivery.onDemand),
        entry('asset.${document.contentItemId}.audio', BundleEntryDelivery.onDemand),
        // Another item's asset, and one that already travels in the core
        // bundle: neither is something to download for this experience.
        entry('asset.someone-else.model', BundleEntryDelivery.onDemand),
        entry('asset.${document.contentItemId}.core', BundleEntryDelivery.core),
      ];

      final needed = arExperienceAssets(document, entries);

      expect(
        needed.map((item) => item.logicalId),
        <String>[
          'asset.${document.contentItemId}.model',
          'asset.${document.contentItemId}.audio',
        ],
      );
    });
  });
}
