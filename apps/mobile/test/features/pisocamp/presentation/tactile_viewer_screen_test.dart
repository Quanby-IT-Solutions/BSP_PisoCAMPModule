import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tactile_patterns.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/tactile_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/tactile_banknote_view.dart';

import '../data/bundle_test_support.dart';

final class _RecordingTactileAnalytics implements TactileAnalytics {
  final List<String> recorded = [];

  @override
  Future<void> recordUse(String logicalId) async => recorded.add(logicalId);
}

void main() {
  late Directory root;
  late CurrencyCatalogView catalog;
  late CurrencyContentDocument banknote;
  late CurrencyContentDocument coin;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce4-tactile-');
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
    banknote = catalog.documentsFor(CurrencyRouteKind.banknotes).first;
    coin = catalog.documentsFor(CurrencyRouteKind.coins).first;
    // Read the illustration here: a widget test's fake clock never advances
    // file I/O, and the view caches a resource by digest anyway.
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
    bool hapticsAvailable = true,
    TactileAnalytics? analytics,
    TactilePlayer? player,
  }) {
    return ProviderScope(
      overrides: [
        currencyCatalogViewProvider.overrideWith((ref) async => catalog),
        tactileAnalyticsProvider.overrideWithValue(
          analytics ?? _RecordingTactileAnalytics(),
        ),
      ],
      child: MaterialApp(
        home: TactileViewerScreen(
          kind: kind,
          logicalId: document.logicalId,
          hapticsAvailable: hapticsAvailable,
          player: player,
        ),
      ),
    );
  }

  Future<void> open(WidgetTester tester, Widget widget) async {
    await tester.pumpWidget(widget);
    for (var round = 0; round < 3; round += 1) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pumpAndSettle();
    }
  }

  testWidgets('opens a mandatory banknote with its approved regions', (
    tester,
  ) async {
    await open(
      tester,
      subject(document: banknote, kind: CurrencyRouteKind.banknotes),
    );

    expect(find.byType(TactileBanknoteView), findsOneWidget);
    expect(find.text(banknote.title), findsOneWidget);
    for (final region in banknote.tactileRegions) {
      expect(find.text(region.label), findsOneWidget);
    }
  });

  testWidgets('says it is a simulation before anything can be touched', (
    tester,
  ) async {
    await open(
      tester,
      subject(document: banknote, kind: CurrencyRouteKind.banknotes),
    );

    expect(find.textContaining('This is a simulation'), findsOneWidget);
    expect(
      find.textContaining('do not reproduce any real banknote'),
      findsOneWidget,
    );
  });

  testWidgets('touching a region plays its mapped pattern and highlights it', (
    tester,
  ) async {
    final played = <TactileStrength>[];
    final player = TactilePlayer(
      impact: (strength) async => played.add(strength),
      wait: (delay) async {},
    );
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        player: player,
      ),
    );

    final bars = banknote.tactileRegions.firstWhere(
      (region) => region.pattern == 'bars',
    );
    await tester.tap(find.text(bars.label));
    await tester.pumpAndSettle();

    expect(played, everyElement(TactileStrength.medium));
    expect(played, hasLength(kApprovedTactilePatterns['bars']!.pulses.length));
    // The highlight names the region and says what it feels like, so the
    // simulation is legible with or without the vibration.
    expect(find.textContaining(bars.label), findsWidgets);
    expect(find.textContaining('steady taps'), findsOneWidget);
  });

  testWidgets('a device that cannot vibrate gets the visual alternative', (
    tester,
  ) async {
    final played = <TactileStrength>[];
    final player = TactilePlayer(
      impact: (strength) async => played.add(strength),
      wait: (delay) async {},
    );
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        hapticsAvailable: false,
        player: player,
      ),
    );

    expect(find.textContaining('This device cannot vibrate'), findsOneWidget);
    expect(find.byType(SwitchListTile), findsNothing);

    final region = banknote.tactileRegions.first;
    await tester.tap(find.text(region.label));
    await tester.pumpAndSettle();

    expect(played, isEmpty, reason: 'nothing may be sent to a silent device');
    expect(find.textContaining(region.label), findsWidgets);
  });

  testWidgets(
    'turning vibration off keeps the description and stops the buzz',
    (tester) async {
      final played = <TactileStrength>[];
      final player = TactilePlayer(
        impact: (strength) async => played.add(strength),
        wait: (delay) async {},
      );
      await open(
        tester,
        subject(
          document: banknote,
          kind: CurrencyRouteKind.banknotes,
          player: player,
        ),
      );

      // The switch sits below the illustration, so it can start off-screen.
      await tester.ensureVisible(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();

      final region = banknote.tactileRegions.first;
      await tester.tap(find.text(region.label));
      await tester.pumpAndSettle();

      expect(played, isEmpty);
      expect(find.textContaining(region.label), findsWidgets);
    },
  );

  testWidgets('records one feature_use for the note it opened', (tester) async {
    final analytics = _RecordingTactileAnalytics();
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        analytics: analytics,
      ),
    );

    expect(analytics.recorded, [banknote.logicalId]);

    await tester.tap(find.text(banknote.tactileRegions.first.label));
    await tester.pumpAndSettle();
    expect(
      analytics.recorded,
      hasLength(1),
      reason: 'touching is not reopening',
    );
  });

  testWidgets(
    'an item with no approved map explains itself and records nothing',
    (tester) async {
      final analytics = _RecordingTactileAnalytics();
      await open(
        tester,
        subject(
          document: coin,
          kind: CurrencyRouteKind.coins,
          analytics: analytics,
        ),
      );

      expect(find.byType(TactileBanknoteView), findsNothing);
      expect(find.text('Tactile Simulation Unavailable'), findsOneWidget);
      expect(analytics.recorded, isEmpty);
    },
  );

  testWidgets('every region is a labelled button of its own', (tester) async {
    final handle = tester.ensureSemantics();
    await open(
      tester,
      subject(document: banknote, kind: CurrencyRouteKind.banknotes),
    );

    for (final region in banknote.tactileRegions) {
      expect(
        find.bySemanticsLabel('Tactile feature: ${region.label}'),
        findsOneWidget,
        reason: region.id,
      );
    }
    handle.dispose();
  });
}
