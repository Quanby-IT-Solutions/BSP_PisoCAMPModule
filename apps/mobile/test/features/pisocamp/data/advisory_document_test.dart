import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/advisory_document.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:shared_preferences/shared_preferences.dart';

String advisoryItemId(int index) =>
    '5a6b7c8d-9e0f-4a1b-8c2d-${index.toString().padLeft(12, '0')}';

Uint8List advisoryBytes({
  int index = 1,
  List<Map<String, Object?>> links = const [],
  Map<String, Object?> overrides = const {},
}) {
  final itemId = advisoryItemId(index);
  return Uint8List.fromList(
    utf8.encode(
      jsonEncode({
        'schemaVersion': 1,
        'logicalId': 'content.$itemId',
        'contentItemId': itemId,
        'contentVersionId': '0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74',
        'versionNo': 3,
        'contentType': 'advisory',
        'title': 'Handle your money well',
        'summary': 'A few habits that keep banknotes usable.',
        'body': 'Keep notes flat and dry, and do not write on them.',
        'seriesCode': null,
        'denominationCode': null,
        'primaryUrl': null,
        'featureLevel': null,
        'hotspot': null,
        'relatedLinks': links,
        ...overrides,
      }),
    ),
  );
}

void main() {
  group('reading a published advisory', () {
    test('reads the approved words and its links', () {
      final parsed = AdvisoryDocument.parsePublished(
        advisoryBytes(
          links: [
            {
              'id': '33333333-3333-4333-8333-333333333333',
              'position': 0,
              'kind': 'external',
              'label': 'BSP guidance',
              'url': 'https://www.bsp.gov.ph/',
            },
          ],
        ),
      );

      expect(parsed.title, 'Handle your money well');
      expect(parsed.body, contains('flat and dry'));
      expect(parsed.links.single.kind, AdvisoryLinkKind.external);
      expect(parsed.links.single.destination, 'https://www.bsp.gov.ph/');
    });

    void rejects(String reason, Uint8List bytes) {
      test('rejects $reason', () {
        expect(
          () => AdvisoryDocument.parsePublished(bytes),
          throwsA(isA<BundleValidationException>()),
        );
      });
    }

    rejects(
      'a non-advisory document',
      advisoryBytes(overrides: {'contentType': 'survey'}),
    );
    rejects(
      'an advisory carrying a disclosure level',
      advisoryBytes(overrides: {'featureLevel': 'first'}),
    );
    rejects('markup in the body', advisoryBytes(overrides: {'body': '<b>Hi</b>'}));
    rejects(
      'a plain-http link',
      advisoryBytes(
        links: [
          {
            'id': '33333333-3333-4333-8333-333333333333',
            'position': 0,
            'kind': 'external',
            'label': 'BSP',
            'url': 'http://www.bsp.gov.ph/',
          },
        ],
      ),
    );
    rejects(
      'a link of an unknown kind',
      advisoryBytes(
        links: [
          {
            'id': '33333333-3333-4333-8333-333333333333',
            'position': 0,
            'kind': 'telephone',
            'label': 'Call us',
            'url': 'tel:+63',
          },
        ],
      ),
    );
    rejects(
      'a logicalId that names another item',
      advisoryBytes(overrides: {'logicalId': 'content.something-else'}),
    );
  });

  group('choosing the exit advisory', () {
    test('offers nothing when there is none', () {
      expect(exitAdvisoryFrom(const []), isNull);
    });

    test('offers the same one every visit', () {
      final advisories = [
        AdvisoryDocument.parsePublished(advisoryBytes(index: 3)),
        AdvisoryDocument.parsePublished(advisoryBytes(index: 1)),
      ];

      // Stable rather than shuffled: somebody leaving twice should not get a
      // different piece of advice each time by accident.
      expect(exitAdvisoryFrom(advisories)?.contentItemId, advisoryItemId(1));
      expect(
        exitAdvisoryFrom(advisories.reversed.toList())?.contentItemId,
        advisoryItemId(1),
      );
    });
  });

  group('AC1 — once per configured interval', () {
    final now = DateTime.utc(2026, 9, 2, 12);

    test('is due when it has never been shown', () {
      expect(
        advisoryIsDue(now: now, lastShown: null, intervalHours: 24),
        isTrue,
      );
    });

    test('is not due inside the interval, and due exactly on it', () {
      expect(
        advisoryIsDue(
          now: now,
          lastShown: now.subtract(const Duration(hours: 23, minutes: 59)),
          intervalHours: 24,
        ),
        isFalse,
      );
      expect(
        advisoryIsDue(
          now: now,
          lastShown: now.subtract(const Duration(hours: 24)),
          intervalHours: 24,
        ),
        isTrue,
      );
    });

    test('honours an interval other than a day', () {
      expect(
        advisoryIsDue(
          now: now,
          lastShown: now.subtract(const Duration(hours: 5)),
          intervalHours: 6,
        ),
        isFalse,
      );
      expect(
        advisoryIsDue(
          now: now,
          lastShown: now.subtract(const Duration(hours: 6)),
          intervalHours: 6,
        ),
        isTrue,
      );
    });
  });

  group('the display store', () {
    setUp(() => SharedPreferences.setMockInitialValues(const {}));

    test('remembers across a restart', () async {
      final at = DateTime.utc(2026, 9, 2, 12);
      final store = PreferencesAdvisoryDisplayStore(
        await SharedPreferences.getInstance(),
      );

      await store.recordShown(at);

      final reopened = PreferencesAdvisoryDisplayStore(
        await SharedPreferences.getInstance(),
      );
      expect(await reopened.readLastShown(), at);
    });

    test('treats unreadable history as never shown', () async {
      SharedPreferences.setMockInitialValues({
        PreferencesAdvisoryDisplayStore.storageKey: 'not a time',
      });
      final store = PreferencesAdvisoryDisplayStore(
        await SharedPreferences.getInstance(),
      );

      expect(await store.readLastShown(), isNull);
    });
  });
}
