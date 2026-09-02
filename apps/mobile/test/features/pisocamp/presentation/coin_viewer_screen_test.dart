import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/coin_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/coin_viewer.dart';

import '../data/bundle_test_support.dart';

final class _RecordingCoinAnalytics implements CoinViewerAnalytics {
  final List<String> recorded = [];

  @override
  Future<void> recordUse(String logicalId) async => recorded.add(logicalId);
}

void main() {
  late Directory root;
  late CurrencyCatalogView catalog;
  late CurrencyContentDocument coin;
  late CurrencyContentDocument banknote;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce2-viewer-');
    final testKeys = await TestSignedBundle.create(
      version: '1',
      resources: [
        TestBundleResource(
          logicalId: 'content.test-key',
          bytes: Uint8List.fromList(utf8.encode('{"test":true}')),
        ),
      ],
    );
    final store = BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: testKeys.keyRing,
      versionedUrl: Uri.parse(ApiConstants.versionedUrl),
    );
    catalog = await CurrencyCatalogView.load(await store.bootstrap());
    coin = catalog.documentsFor(CurrencyRouteKind.coins).first;
    banknote = catalog.documentsFor(CurrencyRouteKind.banknotes).first;
    // Read the bundle here, outside the widget tests. A widget test runs on a
    // fake clock that never advances real file I/O, so the screen would sit on
    // its loading state forever; the view caches a resource by digest, so
    // priming it is what the second visitor to a coin sees anyway.
    await catalog.readModel(coin);
    await catalog.readImage(banknote);
  });

  tearDown(() async {
    for (var attempt = 0; attempt < 10 && await root.exists(); attempt += 1) {
      try {
        await root.delete(recursive: true);
      } on FileSystemException {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
    }
  });

  Widget subject({
    required CurrencyContentDocument document,
    required CurrencyRouteKind kind,
    CoinViewerAnalytics? analytics,
    bool reduceMotion = false,
    CurrencyCatalogView? provided,
  }) {
    return ProviderScope(
      overrides: [
        currencyCatalogViewProvider.overrideWith((ref) async => catalog),
        // Always overridden: the real SDK reaches platform channels a widget
        // test has no answer for, and its guarded failure would be noise.
        coinViewerAnalyticsProvider.overrideWithValue(
          analytics ?? _RecordingCoinAnalytics(),
        ),
      ],
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(disableAnimations: reduceMotion),
          child: child!,
        ),
        home: CoinViewerScreen(
          kind: kind,
          logicalId: document.logicalId,
          initialCatalog: provided,
        ),
      ),
    );
  }

  CoinOrientation orientationOf(WidgetTester tester) =>
      tester.widget<CoinModelView>(find.byType(CoinModelView)).orientation;

  /// Angles are compared as directions, not as numbers: turning the coin twice
  /// through half a turn leaves it facing forwards at a yaw of 2π.
  double facingDifference(double yaw, double target) {
    const fullTurn = math.pi * 2;
    final difference = (yaw - target).abs() % fullTurn;
    return difference > math.pi ? fullTurn - difference : difference;
  }

  /// The bundle read is primed in [setUp], but the future that carries it was
  /// created outside this test's fake clock, so one turn of the real event loop
  /// is needed before the screen's `FutureBuilder` sees it.
  Future<void> open(WidgetTester tester, Widget widget) async {
    await tester.pumpWidget(widget);
    // Each round lets one more nested read land: the screen resolves the coin,
    // and a fallback then resolves its image.
    for (var round = 0; round < 3; round += 1) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pumpAndSettle();
    }
  }

  testWidgets('opens a mandatory coin in 3D from the saved bundle', (
    tester,
  ) async {
    await open(tester, subject(document: coin, kind: CurrencyRouteKind.coins));

    expect(find.byType(CoinModelView), findsOneWidget);
    expect(find.text(coin.title), findsOneWidget);
    expect(find.text('Zoom 100%'), findsOneWidget);
    expect(orientationOf(tester), CoinOrientation.obverse);
  });

  testWidgets('a face preset animates the camera to that face', (tester) async {
    await open(tester, subject(document: coin, kind: CurrencyRouteKind.coins));

    await tester.tap(find.text('Reverse'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 120));
    final midway = orientationOf(tester);
    expect(
      midway.yaw,
      greaterThan(0),
      reason: 'the camera should be part-way round, not already there',
    );
    expect(midway.yaw, lessThan(CoinOrientation.reverse.yaw));

    await tester.pumpAndSettle();
    expect(
      facingDifference(orientationOf(tester).yaw, CoinOrientation.reverse.yaw),
      closeTo(0, 1e-9),
    );

    await tester.tap(find.text('Edge'));
    await tester.pumpAndSettle();
    expect(
      orientationOf(tester).pitch,
      closeTo(CoinOrientation.edge.pitch, 1e-9),
    );

    await tester.tap(find.text('Obverse'));
    await tester.pumpAndSettle();
    expect(
      facingDifference(orientationOf(tester).yaw, CoinOrientation.obverse.yaw),
      closeTo(0, 1e-9),
    );
  });

  testWidgets('reduced motion lands on the face immediately', (tester) async {
    await open(
      tester,
      subject(
        document: coin,
        kind: CurrencyRouteKind.coins,
        reduceMotion: true,
      ),
    );

    await tester.tap(find.text('Reverse'));
    await tester.pump();

    expect(orientationOf(tester), CoinOrientation.reverse);
  });

  testWidgets('zoom steps within limits and Reset returns the default view', (
    tester,
  ) async {
    await open(tester, subject(document: coin, kind: CurrencyRouteKind.coins));

    await tester.tap(find.text('Zoom in'));
    await tester.pump();
    expect(find.text('Zoom 125%'), findsOneWidget);

    for (var step = 0; step < 10; step += 1) {
      final button = find.widgetWithText(OutlinedButton, 'Zoom in');
      if (tester.widget<OutlinedButton>(button).onPressed == null) break;
      await tester.tap(button);
      await tester.pump();
    }
    expect(find.text('Zoom 300%'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Zoom in'),
          )
          .onPressed,
      isNull,
      reason: 'the limit is shown, not silently ignored',
    );

    await tester.tap(find.text('Reset'));
    await tester.pumpAndSettle();
    expect(find.text('Zoom 100%'), findsOneWidget);
    expect(orientationOf(tester), CoinOrientation.initial);
  });

  testWidgets('dragging the coin turns it away from the default view', (
    tester,
  ) async {
    await open(tester, subject(document: coin, kind: CurrencyRouteKind.coins));

    await tester.drag(find.byType(CoinModelView), const Offset(80, 20));
    await tester.pump();

    expect(orientationOf(tester), isNot(CoinOrientation.obverse));
  });

  testWidgets('records one feature_use for the coin it opened', (tester) async {
    final analytics = _RecordingCoinAnalytics();
    await open(
      tester,
      subject(
        document: coin,
        kind: CurrencyRouteKind.coins,
        analytics: analytics,
      ),
    );

    expect(analytics.recorded, [coin.logicalId]);

    // Turning the coin is not a second opening.
    await tester.tap(find.text('Edge'));
    await tester.pumpAndSettle();
    expect(analytics.recorded, hasLength(1));
  });

  testWidgets('an item with no model explains itself and shows the image', (
    tester,
  ) async {
    final analytics = _RecordingCoinAnalytics();
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        analytics: analytics,
      ),
    );

    expect(find.byType(CoinModelView), findsNothing);
    expect(find.text('3D View Unavailable'), findsOneWidget);
    expect(find.textContaining('does not have a 3D model'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
    expect(
      analytics.recorded,
      isEmpty,
      reason: 'a fallback notice is not a use of the 3D feature',
    );
  });

  testWidgets('an unknown item fails closed without a stage', (tester) async {
    await open(
      tester,
      ProviderScope(
        overrides: [
          currencyCatalogViewProvider.overrideWith((ref) async => catalog),
        ],
        child: const MaterialApp(
          home: CoinViewerScreen(
            kind: CurrencyRouteKind.coins,
            logicalId: 'catalog.ngc-coins.php-999',
          ),
        ),
      ),
    );

    expect(find.byType(CoinModelView), findsNothing);
    expect(find.text('3D View Unavailable'), findsOneWidget);
  });

  testWidgets('a catalog handed in by the route is used as given', (
    tester,
  ) async {
    await open(
      tester,
      subject(document: coin, kind: CurrencyRouteKind.coins, provided: catalog),
    );

    expect(find.byType(CoinModelView), findsOneWidget);
  });
}
