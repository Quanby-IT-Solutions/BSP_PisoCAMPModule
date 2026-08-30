import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/bundle_protocol.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';

void main() {
  final seedRoot = Directory('assets/pisocamp/bundle/seed');
  Uint8List seedDocumentBytes() => Uint8List.fromList(
    utf8.encode(
      '{"schemaVersion":1,"logicalId":"catalog.ngc-banknotes.php-20","contentType":"banknote","seriesCode":"ngc-banknotes","seriesName":"New Generation Currency Banknotes","seriesOrder":2,"denominationCode":"php-20","denominationLabel":"PHP 20","denominationOrder":0,"title":"PHP 20 — New Generation Currency Banknotes","summary":"This offline catalog entry identifies PHP 20 in New Generation Currency Banknotes.","body":"This offline baseline identifies the catalog entry. See the linked BSP source for current design and security guidance.","catalogVersion":"BSP-CURRENCY-2026-08-25","sourceUrl":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx","imageSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","imageAlt":"A neutral fictional banknote education illustration, not a reproduction.","relatedLinks":[{"label":"Bangko Sentral ng Pilipinas source","url":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx"}]}',
    ),
  );

  test(
    'opens the signed packaged seed and parses all 29 strict documents offline',
    () async {
      final envelope = await BundleEnvelope.parseAndVerify(
        Uint8List.fromList(
          await File('${seedRoot.path}/manifest.envelope.json').readAsBytes(),
        ),
        BundleKeyRing.packagedSeed(),
      );
      final index =
          jsonDecode(
                await File(
                  '${seedRoot.path}/resource-index.json',
                ).readAsString(),
              )
              as Map<String, dynamic>;
      final documents = <CurrencyContentDocument>[];

      for (final entry in envelope.manifest.entries.where(
        (entry) => entry.kind == BundleEntryKind.content,
      )) {
        final assetPath = index[entry.sha256] as String;
        final bytes = Uint8List.fromList(await File(assetPath).readAsBytes());
        await entry.validateResource(bytes);
        documents.add(CurrencyContentDocument.parseSeed(bytes));
      }

      expect(documents, hasLength(29));
      expect(
        documents.where((entry) => entry.kind == CurrencyContentKind.banknote),
        hasLength(15),
      );
      expect(
        documents.where((entry) => entry.kind == CurrencyContentKind.coin),
        hasLength(14),
      );
      expect(documents.map((entry) => entry.seriesCode).toSet(), hasLength(5));
    },
  );

  test(
    'normalizes the exact Task 3 published shape through the frozen catalog lookup',
    () {
      final catalog = CurrencyCatalogLookup.fromSeedDocuments([
        CurrencyContentDocument.parseSeed(
          Uint8List.fromList(
            utf8.encode(
              '{"schemaVersion":1,"logicalId":"catalog.ngc-banknotes.php-20","contentType":"banknote","seriesCode":"ngc-banknotes","seriesName":"New Generation Currency Banknotes","seriesOrder":2,"denominationCode":"php-20","denominationLabel":"PHP 20","denominationOrder":0,"title":"PHP 20 — New Generation Currency Banknotes","summary":"This offline catalog entry identifies PHP 20 in New Generation Currency Banknotes.","body":"This offline baseline identifies the catalog entry. See the linked BSP source for current design and security guidance.","catalogVersion":"BSP-CURRENCY-2026-08-25","sourceUrl":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx","imageSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","imageAlt":"A neutral fictional banknote education illustration, not a reproduction.","relatedLinks":[{"label":"Bangko Sentral ng Pilipinas source","url":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx"}]}',
            ),
          ),
        ),
      ]);
      final document = CurrencyContentDocument.parsePublished(
        Uint8List.fromList(
          utf8.encode(
            '{"schemaVersion":1,"logicalId":"content.11111111-1111-4111-8111-111111111111","contentItemId":"11111111-1111-4111-8111-111111111111","contentVersionId":"22222222-2222-4222-8222-222222222222","versionNo":7,"contentType":"security_feature","title":"Feature","summary":"Summary","body":"Body","seriesCode":"ngc-banknotes","denominationCode":"php-20","primaryUrl":null,"relatedLinks":[]}',
          ),
        ),
        catalog,
      );

      expect(document.kind, CurrencyContentKind.securityFeature);
      expect(document.seriesName, 'New Generation Currency Banknotes');
      expect(document.seriesOrder, 2);
      expect(document.denominationLabel, 'PHP 20');
      expect(document.denominationOrder, 0);
    },
  );

  test('rejects unsafe URLs, duplicate fields, and extra fields', () {
    final valid =
        '{"schemaVersion":1,"logicalId":"catalog.ngc-banknotes.php-20","contentType":"banknote","seriesCode":"ngc-banknotes","seriesName":"New Generation Currency Banknotes","seriesOrder":2,"denominationCode":"php-20","denominationLabel":"PHP 20","denominationOrder":0,"title":"PHP 20 — New Generation Currency Banknotes","summary":"This offline catalog entry identifies PHP 20 in New Generation Currency Banknotes.","body":"This offline baseline identifies the catalog entry. See the linked BSP source for current design and security guidance.","catalogVersion":"BSP-CURRENCY-2026-08-25","sourceUrl":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx","imageSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","imageAlt":"A neutral fictional banknote education illustration, not a reproduction.","relatedLinks":[{"label":"Bangko Sentral ng Pilipinas source","url":"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx"}]}';

    for (final invalid in <String>[
      valid.replaceFirst('https://www.bsp.gov.ph/', 'http://www.bsp.gov.ph/'),
      valid.replaceFirst(
        '"schemaVersion":1,',
        '"schemaVersion":1,"schemaVersion":1,',
      ),
      valid.replaceFirst(
        '"schemaVersion":1,',
        '"schemaVersion":1,"extra":true,',
      ),
    ]) {
      expect(
        () => CurrencyContentDocument.parseSeed(
          Uint8List.fromList(utf8.encode(invalid)),
        ),
        throwsA(isA<BundleValidationException>()),
      );
    }
  });

  test('rejects a published series-denomination absent from the catalog', () {
    final catalog = CurrencyCatalogLookup.fromSeedDocuments([
      CurrencyContentDocument.parseSeed(seedDocumentBytes()),
    ]);
    final bytes = Uint8List.fromList(
      utf8.encode(
        '{"schemaVersion":1,"logicalId":"content.11111111-1111-4111-8111-111111111111","contentItemId":"11111111-1111-4111-8111-111111111111","contentVersionId":"22222222-2222-4222-8222-222222222222","versionNo":7,"contentType":"security_feature","title":"Feature","summary":"Summary","body":"Body","seriesCode":"ngc-banknotes","denominationCode":"php-999","primaryUrl":null,"relatedLinks":[]}',
      ),
    );

    expect(
      () => CurrencyContentDocument.parsePublished(bytes, catalog),
      throwsA(
        isA<BundleValidationException>().having(
          (error) => error.message,
          'message',
          contains('not in the frozen catalog'),
        ),
      ),
    );
  });

  test('preserves every strict Task 3 related-link variant', () {
    final catalog = CurrencyCatalogLookup.fromSeedDocuments([
      CurrencyContentDocument.parseSeed(seedDocumentBytes()),
    ]);
    final cases =
        <
          ({
            Map<String, Object?> value,
            CurrencyRelatedLinkKind kind,
            String destination,
          })
        >[
          (
            value: {
              'id': '33333333-3333-4333-8333-333333333333',
              'position': 0,
              'kind': 'external',
              'label': 'BSP source',
              'url': 'https://www.bsp.gov.ph/currency',
            },
            kind: CurrencyRelatedLinkKind.external,
            destination: 'https://www.bsp.gov.ph/currency',
          ),
          (
            value: {
              'id': '44444444-4444-4444-8444-444444444444',
              'position': 0,
              'kind': 'internal',
              'label': 'Saved currency guide',
              'route': '/pisocamp/currency/banknotes',
            },
            kind: CurrencyRelatedLinkKind.internal,
            destination: '/pisocamp/currency/banknotes',
          ),
          (
            value: {
              'id': '55555555-5555-4555-8555-555555555555',
              'position': 0,
              'kind': 'topic',
              'label': 'Related topic',
              'targetContentItemId': '66666666-6666-4666-8666-666666666666',
            },
            kind: CurrencyRelatedLinkKind.topic,
            destination: '66666666-6666-4666-8666-666666666666',
          ),
        ];

    for (final linkCase in cases) {
      final document = CurrencyContentDocument.parsePublished(
        Uint8List.fromList(
          utf8.encode(
            jsonEncode({
              'schemaVersion': 1,
              'logicalId': 'content.11111111-1111-4111-8111-111111111111',
              'contentItemId': '11111111-1111-4111-8111-111111111111',
              'contentVersionId': '22222222-2222-4222-8222-222222222222',
              'versionNo': 7,
              'contentType': 'security_feature',
              'title': 'Feature',
              'summary': 'Summary',
              'body': 'Body',
              'seriesCode': 'ngc-banknotes',
              'denominationCode': 'php-20',
              'primaryUrl': null,
              'relatedLinks': [linkCase.value],
            }),
          ),
        ),
        catalog,
      );

      final publishedLink = document.relatedLinks.singleWhere(
        (link) => link.id != null,
      );
      expect(publishedLink.kind, linkCase.kind);
      expect(publishedLink.position, 0);
      expect(switch (publishedLink.kind) {
        CurrencyRelatedLinkKind.external => publishedLink.url.toString(),
        CurrencyRelatedLinkKind.internal => publishedLink.route,
        CurrencyRelatedLinkKind.topic => publishedLink.targetContentItemId,
      }, linkCase.destination);
    }
  });

  test('rejects malformed Task 3 related-link variants', () {
    final catalog = CurrencyCatalogLookup.fromSeedDocuments([
      CurrencyContentDocument.parseSeed(seedDocumentBytes()),
    ]);
    final invalidLinks = <Map<String, Object?>>[
      {
        'id': '33333333-3333-4333-8333-333333333333',
        'position': 0,
        'kind': 'external',
        'label': 'Unsafe',
        'url': 'https://example.com/not-bsp',
      },
      {
        'id': '44444444-4444-4444-8444-444444444444',
        'position': 0,
        'kind': 'internal',
        'label': 'Unsafe route',
        'route': '/pisocamp/../admin',
      },
      {
        'id': '55555555-5555-4555-8555-555555555555',
        'position': 0,
        'kind': 'topic',
        'label': 'Bad topic',
        'targetContentItemId': 'not-a-uuid',
      },
      {
        'id': '33333333-3333-4333-8333-333333333333',
        'position': 0,
        'kind': 'external',
        'label': 'Extra',
        'url': 'https://www.bsp.gov.ph/currency',
        'extra': true,
      },
    ];

    for (final invalidLink in invalidLinks) {
      final bytes = Uint8List.fromList(
        utf8.encode(
          jsonEncode({
            'schemaVersion': 1,
            'logicalId': 'content.11111111-1111-4111-8111-111111111111',
            'contentItemId': '11111111-1111-4111-8111-111111111111',
            'contentVersionId': '22222222-2222-4222-8222-222222222222',
            'versionNo': 7,
            'contentType': 'security_feature',
            'title': 'Feature',
            'summary': 'Summary',
            'body': 'Body',
            'seriesCode': 'ngc-banknotes',
            'denominationCode': 'php-20',
            'primaryUrl': null,
            'relatedLinks': [invalidLink],
          }),
        ),
      );
      expect(
        () => CurrencyContentDocument.parsePublished(bytes, catalog),
        throwsA(isA<BundleValidationException>()),
      );
    }
  });
}
