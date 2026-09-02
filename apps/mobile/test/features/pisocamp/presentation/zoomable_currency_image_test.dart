import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/zoomable_currency_image.dart';

/// The packaged seed illustration, 1536x1024. A real, large source is the
/// point: the magnification limit is derived from how many pixels it has.
const _imageAsset =
    'assets/pisocamp/bundle/seed/source/neutral-banknote-education.png';
late final VerifiedCurrencyImage _image;

final _catalog = CurrencyCatalogLookup.fromSeedDocuments([
  CurrencyContentDocument.parseSeed(
    Uint8List.fromList(
      utf8.encode(
        jsonEncode({
          'schemaVersion': 1,
          'logicalId': 'catalog.ngc-banknotes.php-20',
          'contentType': 'banknote',
          'seriesCode': 'ngc-banknotes',
          'seriesName': 'New Generation Currency Banknotes',
          'seriesOrder': 0,
          'denominationCode': 'php-20',
          'denominationLabel': 'PHP 20',
          'denominationOrder': 0,
          'title': 'PHP 20',
          'summary': 'Catalog summary.',
          'body': 'Catalog body.',
          'catalogVersion': 'TEST-2026',
          'sourceUrl':
              'https://www.bsp.gov.ph/SitePages/CoinsAndNotes/notes.aspx',
          'relatedLinks': [
            {
              'label': 'Bangko Sentral ng Pilipinas source',
              'url':
                  'https://www.bsp.gov.ph/SitePages/CoinsAndNotes/notes.aspx',
            },
          ],
        }),
      ),
    ),
  ),
]);

CurrencyContentDocument _feature({
  required String id,
  required String title,
  Map<String, Object?>? hotspot,
}) {
  return CurrencyContentDocument.parsePublished(
    Uint8List.fromList(
      utf8.encode(
        jsonEncode({
          'schemaVersion': 1,
          'logicalId': 'content.$id',
          'contentItemId': id,
          'contentVersionId': '22222222-2222-4222-8222-222222222222',
          'versionNo': 1,
          'contentType': 'security_feature',
          'title': title,
          'summary': '$title summary.',
          'body': '$title body, in approved plain text.',
          'seriesCode': 'ngc-banknotes',
          'denominationCode': 'php-20',
          'primaryUrl': null,
          'featureLevel': 'first',
          'hotspot': hotspot,
          'relatedLinks': <Object?>[],
        }),
      ),
    ),
    _catalog,
  );
}

Widget _subject({
  required List<CurrencyContentDocument> features,
  double devicePixelRatio = 3,
  Size size = const Size(400, 800),
}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(size: size, devicePixelRatio: devicePixelRatio),
      child: Scaffold(
        body: SingleChildScrollView(
          child: ZoomableCurrencyImage(
            image: _image,
            alt:
                'A neutral fictional banknote illustration, not a reproduction.',
            features: features,
          ),
        ),
      ),
    ),
  );
}

void main() {
  setUpAll(() async {
    // Read outside the widget tests: a fake clock never advances file I/O.
    _image = VerifiedCurrencyImage.parse(
      await File(_imageAsset).readAsBytes(),
      'image/png',
    )!;
  });

  group('the magnification limit', () {
    test('stops where the source runs out of pixels', () {
      // A 2000 px image fitted into 400 logical px on a 3x screen is already
      // using 1200 of its pixels, so 1.67x exhausts it.
      expect(
        ZoomableCurrencyImage.pixelLimit(
          fittedScale: 400 / 2000,
          devicePixelRatio: 3,
        ),
        closeTo(1 / 0.6, 1e-9),
      );
      expect(
        ZoomableCurrencyImage.maximumScaleFor(
          fittedScale: 400 / 2000,
          devicePixelRatio: 3,
        ),
        closeTo(1 / 0.6, 1e-9),
      );
    });

    test('never exceeds the approved maximum, however large the source', () {
      expect(
        ZoomableCurrencyImage.maximumScaleFor(
          fittedScale: 400 / 40000,
          devicePixelRatio: 1,
        ),
        kApprovedMaximumZoom,
      );
    });

    test('stays usable when the source is already being enlarged to fit', () {
      // A tiny image stretched to fill the view is past 1:1 at rest, so the
      // limit is clamped rather than dropping below the resting scale.
      expect(
        ZoomableCurrencyImage.maximumScaleFor(
          fittedScale: 4,
          devicePixelRatio: 3,
        ),
        1,
      );
    });

    test('falls back to the approved maximum for a degenerate layout', () {
      expect(
        ZoomableCurrencyImage.maximumScaleFor(
          fittedScale: 0,
          devicePixelRatio: 3,
        ),
        kApprovedMaximumZoom,
      );
    });
  });

  group('ZoomableCurrencyImage', () {
    testWidgets('offers pinch-zoom and pan over the saved image', (
      tester,
    ) async {
      // A phone-sized surface, so the 1536 px source still has headroom: at the
      // default 800 px test surface it is already being enlarged to fit.
      await tester.binding.setSurfaceSize(const Size(400, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(_subject(features: const []));
      await tester.pumpAndSettle();

      final viewer = tester.widget<InteractiveViewer>(
        find.byType(InteractiveViewer),
      );
      expect(viewer.minScale, 1);
      // 400 logical px at 3x needs 1200 of the source's 1536 pixels, leaving
      // 1.28x of headroom before the image would be interpolated.
      expect(viewer.maxScale, closeTo(1536 / 1200, 1e-9));
      expect(viewer.maxScale, lessThanOrEqualTo(kApprovedMaximumZoom));
      expect(viewer.panEnabled, isTrue);
      expect(viewer.scaleEnabled, isTrue);
    });

    testWidgets('marks only the features whose position was approved', (
      tester,
    ) async {
      final marked = _feature(
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Watermark',
        hotspot: {'x': 250, 'y': 640},
      );
      final unmarked = _feature(
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Security thread',
      );
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_subject(features: [marked, unmarked]));
      await tester.pumpAndSettle();

      expect(
        find.bySemanticsLabel('Security feature: Watermark'),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel('Security feature: Security thread'),
        findsNothing,
      );
      handle.dispose();
    });

    testWidgets('anchors a marker where the approved position puts it', (
      tester,
    ) async {
      final centre = _feature(
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Centre',
        hotspot: {'x': 500, 'y': 500},
      );
      final corner = _feature(
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Corner',
        hotspot: {'x': 0, 'y': 0},
      );
      await tester.pumpWidget(_subject(features: [centre, corner]));
      await tester.pumpAndSettle();

      final alignments = tester
          .widgetList<Align>(find.byType(Align))
          .map((align) => align.alignment)
          .whereType<Alignment>()
          .toList();
      expect(alignments, contains(const Alignment(0, 0)));
      expect(alignments, contains(const Alignment(-1, -1)));
    });

    testWidgets('shows the approved description when a marker is tapped', (
      tester,
    ) async {
      final feature = _feature(
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Watermark',
        hotspot: {'x': 500, 'y': 500},
      );
      await tester.pumpWidget(_subject(features: [feature]));
      await tester.pumpAndSettle();

      expect(
        find.text('Watermark body, in approved plain text.'),
        findsNothing,
      );

      await tester.tap(find.byIcon(Icons.search));
      await tester.pumpAndSettle();

      expect(find.text('Watermark'), findsWidgets);
      expect(find.text('Watermark summary.'), findsOneWidget);
      expect(
        find.text('Watermark body, in approved plain text.'),
        findsOneWidget,
      );

      await tester.tap(find.widgetWithText(TextButton, 'Close'));
      await tester.pumpAndSettle();
      expect(
        find.text('Watermark body, in approved plain text.'),
        findsNothing,
      );
    });

    testWidgets('keeps the marker a 44dp target and the image announced', (
      tester,
    ) async {
      final feature = _feature(
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Watermark',
        hotspot: {'x': 500, 'y': 500},
      );
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_subject(features: [feature]));
      await tester.pumpAndSettle();

      final marker = tester.getSize(find.byIcon(Icons.search).hitTestable());
      expect(marker.width, lessThanOrEqualTo(44));
      expect(
        find.bySemanticsLabel(
          'A neutral fictional banknote illustration, not a reproduction.',
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('refuses to enlarge past the pixels it has', (tester) async {
      // The default test surface is wide enough that the source is already
      // stretched, so the viewer offers no magnification at all rather than
      // offering a blurry one.
      await tester.pumpWidget(_subject(features: const []));
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<InteractiveViewer>(find.byType(InteractiveViewer))
            .maxScale,
        1,
      );
    });

    testWidgets('says nothing about zooming when there is nothing marked', (
      tester,
    ) async {
      await tester.pumpWidget(_subject(features: const []));
      await tester.pumpAndSettle();

      expect(find.textContaining('Tap a marked feature'), findsNothing);
    });
  });
}
