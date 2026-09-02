import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/coin_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/currency_detail_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/currency_list_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/tactile_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/tilt_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/coin_viewer.dart';

import '../data/bundle_test_support.dart';
import '../../../support/accessibility_checklist.dart';
import 'package:mobile/features/pisocamp/data/survey_document.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/survey_prompt.dart';

import '../data/survey_document_test.dart'
    show ratingQuestion, surveyBytes, textQuestion;

/// A sync that never touches the network or the filesystem, so the audit
/// measures the screen rather than the platform underneath it.
final class _IdleBundleSync implements CurrencyBundleSync {
  final _states = StreamController<BundleSyncState>.broadcast(sync: true);

  @override
  BundleSyncState get state => const BundleSyncState.idle();

  @override
  Stream<BundleSyncState> get states => _states.stream;

  @override
  Future<void> sync(BundleSyncTrigger trigger) async {}
}

final class _SilentContentViewAnalytics implements ContentViewAnalytics {
  @override
  Future<void> recordOpen(String logicalId) async {}
}

final class _SilentCoinAnalytics implements CoinViewerAnalytics {
  @override
  Future<void> recordUse(String logicalId) async {}
}

final class _SilentTactileAnalytics implements TactileAnalytics {
  @override
  Future<void> recordUse(String logicalId) async {}
}

final class _SilentTiltAnalytics implements TiltAnalytics {
  @override
  Future<void> recordUse(String logicalId) async {}
}

/// F6's audit, run over every Piso CAMP currency screen in Releases 1–2.
///
/// A later UI ticket registers its screen here rather than restating the rules,
/// which is the point of having a checklist at all.
/// Every Piso CAMP screen in Releases 1–2. A later UI ticket adds its screen
/// here and to `buildScreen`, which is the whole registration.
const List<String> kAuditedScreens = [
  'Banknote list',
  'Coin list',
  'Banknote detail',
  'Coin detail',
  'Coin 3D viewer',
  'Tactile viewer',
  'Tilt viewer',
  'Survey prompt',
];

void main() {
  late Directory root;
  late CurrencyCatalogView catalog;
  late CurrencyContentDocument banknote;
  late CurrencyContentDocument coin;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('f6-audit-');
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
    // Read outside the widget tests: a fake clock never advances file I/O.
    await catalog.readImage(banknote);
    await catalog.readImage(coin);
    await catalog.readModel(coin);
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

  Widget wrap(Widget screen) {
    return ProviderScope(
      overrides: [
        currencyCatalogViewProvider.overrideWith((ref) async => catalog),
        currencyBundleSyncProvider.overrideWith(
          (ref) async => _IdleBundleSync(),
        ),
        connectivityStatusProvider.overrideWith(
          (ref) => Stream<bool>.value(false),
        ),
        contentViewAnalyticsProvider.overrideWithValue(
          _SilentContentViewAnalytics(),
        ),
        coinViewerAnalyticsProvider.overrideWithValue(_SilentCoinAnalytics()),
        tactileAnalyticsProvider.overrideWithValue(_SilentTactileAnalytics()),
        tiltAnalyticsProvider.overrideWithValue(_SilentTiltAnalytics()),
      ],
      child: MaterialApp(home: screen),
    );
  }

  /// The screens under audit. Built on demand rather than up front, because
  /// the group tree is assembled before `setUp` has loaded the catalog.
  Widget buildScreen(String name) => <String, Widget>{
    'Banknote list': const CurrencyListScreen(
      kind: CurrencyRouteKind.banknotes,
    ),
    'Coin list': const CurrencyListScreen(kind: CurrencyRouteKind.coins),
    'Banknote detail': CurrencyDetailScreen(
      kind: CurrencyRouteKind.banknotes,
      logicalId: banknote.logicalId,
      initialCatalog: catalog,
    ),
    'Coin detail': CurrencyDetailScreen(
      kind: CurrencyRouteKind.coins,
      logicalId: coin.logicalId,
      initialCatalog: catalog,
    ),
    'Coin 3D viewer': CoinViewerScreen(
      kind: CurrencyRouteKind.coins,
      logicalId: coin.logicalId,
      initialCatalog: catalog,
    ),
    'Tactile viewer': TactileViewerScreen(
      kind: CurrencyRouteKind.banknotes,
      logicalId: banknote.logicalId,
      hapticsAvailable: false,
    ),
    'Tilt viewer': TiltViewerScreen(
      kind: CurrencyRouteKind.banknotes,
      logicalId: banknote.logicalId,
      sensorAvailable: false,
    ),
    // EV-2's prompt is a widget rather than a route, and it is registered all
    // the same: what the checklist audits is a surface a person meets.
    'Survey prompt': Scaffold(
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SurveyPrompt(
            survey: SurveyDocument.parsePublished(
              surveyBytes(questions: [ratingQuestion(), textQuestion()]),
            ),
            consent: SurveyConsentGate(
              alreadyGranted: true,
              noticeTitle: 'How we use your answers',
              noticeBody:
                  'Your answers are kept apart from anything that names you.',
              onDecision: ({required bool granted}) async => granted,
            ),
            onFinished: (_) {},
          ),
        ),
      ),
    ),
  }[name]!;

  Future<void> settle(WidgetTester tester) async {
    for (var round = 0; round < 3; round += 1) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pumpAndSettle();
    }
  }

  for (final name in kAuditedScreens) {
    group(name, () {
      testWidgets('meets the tap-target, label and contrast guidelines', (
        tester,
      ) async {
        await pumpAtScale(
          tester,
          wrap(buildScreen(name)),
          size: kAuditPortrait,
        );
        await settle(tester);

        await expectMeetsGuidelines(tester);
      });

      testWidgets('survives the largest supported text scale', (tester) async {
        await pumpAtScale(
          tester,
          wrap(buildScreen(name)),
          size: kAuditPortrait,
          textScale: kLargestSupportedTextScale,
        );
        await settle(tester);

        expectNoOverflow(tester, reason: '$name overflowed at 200% text');
        expectNoHorizontalScroll(tester);
      });

      testWidgets('survives the narrowest supported width', (tester) async {
        await pumpAtScale(tester, wrap(buildScreen(name)), size: kAuditNarrow);
        await settle(tester);

        expectNoOverflow(tester, reason: '$name overflowed at 320 px');
        expectNoHorizontalScroll(tester);
      });

      testWidgets('survives rotation at the largest text scale', (
        tester,
      ) async {
        await pumpAtScale(
          tester,
          wrap(buildScreen(name)),
          size: kAuditLandscape,
          textScale: kLargestSupportedTextScale,
        );
        await settle(tester);

        expectNoOverflow(tester, reason: '$name overflowed in landscape');
        expectNoHorizontalScroll(tester);
      });
    });
  }

  group('state survives rotation', () {
    /// Rotating must not lose a person's place. The Android manifest declares
    /// `orientation|screenSize` among its `configChanges`, so the activity is
    /// not recreated and Flutter keeps the widget tree; these tests assert the
    /// consequence rather than assuming it, because a later change to that
    /// manifest line would silently break it.
    Future<void> rotate(WidgetTester tester) async {
      await tester.binding.setSurfaceSize(kAuditLandscape);
      await tester.pumpAndSettle();
    }

    testWidgets('a list keeps its scroll position', (tester) async {
      await pumpAtScale(
        tester,
        wrap(buildScreen('Coin list')),
        size: kAuditPortrait,
      );
      await settle(tester);

      final scrollable = find.byType(Scrollable).first;
      await tester.drag(scrollable, const Offset(0, -160));
      await tester.pumpAndSettle();
      final scrolled = tester.widget<Scrollable>(scrollable).controller?.offset;
      expect(scrolled, isNotNull);
      expect(scrolled, greaterThan(0));

      await rotate(tester);

      expect(
        tester
            .widget<Scrollable>(find.byType(Scrollable).first)
            .controller
            ?.offset,
        scrolled,
      );
    });

    testWidgets('the 3D viewer keeps the face and zoom it was showing', (
      tester,
    ) async {
      await pumpAtScale(
        tester,
        wrap(buildScreen('Coin 3D viewer')),
        size: kAuditPortrait,
      );
      await settle(tester);

      await tester.tap(find.text('Reverse'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Zoom in'));
      await tester.pumpAndSettle();
      final before = tester
          .widget<CoinModelView>(find.byType(CoinModelView))
          .orientation;
      expect(before, isNot(CoinOrientation.initial));

      await rotate(tester);

      expect(
        tester.widget<CoinModelView>(find.byType(CoinModelView)).orientation,
        before,
      );
    });

    testWidgets('the tactile viewer keeps the region that was touched', (
      tester,
    ) async {
      await pumpAtScale(
        tester,
        wrap(buildScreen('Tactile viewer')),
        size: kAuditPortrait,
      );
      await settle(tester);

      final region = banknote.tactileRegions.first;
      await tester.tap(find.text(region.label));
      await tester.pumpAndSettle();
      expect(find.textContaining(region.label), findsWidgets);

      await rotate(tester);

      expect(find.textContaining(region.label), findsWidgets);
    });

    testWidgets('the tilt viewer keeps where the slider was left', (
      tester,
    ) async {
      await pumpAtScale(
        tester,
        wrap(buildScreen('Tilt viewer')),
        size: kAuditPortrait,
      );
      await settle(tester);

      final slider = find.byType(Slider);
      await tester.ensureVisible(slider);
      await tester.pumpAndSettle();
      await tester.drag(slider, const Offset(60, 0));
      await tester.pumpAndSettle();
      final before = tester.widget<Slider>(slider).value;
      expect(before, isNot(0));

      await rotate(tester);

      expect(tester.widget<Slider>(find.byType(Slider)).value, before);
    });
  });
}
