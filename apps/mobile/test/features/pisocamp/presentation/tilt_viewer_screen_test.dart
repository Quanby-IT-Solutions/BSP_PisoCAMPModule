import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/currency_content_document.dart';
import 'package:mobile/features/pisocamp/data/tilt_effects.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/tilt_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/tilt_banknote_view.dart';

import '../data/bundle_test_support.dart';

final class _RecordingTiltAnalytics implements TiltAnalytics {
  final List<String> recorded = [];

  @override
  Future<void> recordUse(String logicalId) async => recorded.add(logicalId);
}

/// A sensor whose readings the test decides.
final class _ScriptedTiltSource implements TiltSource {
  final StreamController<double> _controller =
      StreamController<double>.broadcast();
  var disposed = false;

  void emit(double tilt) => _controller.add(tilt);

  @override
  Stream<double> get tilts => _controller.stream;

  @override
  Future<void> dispose() async {
    disposed = true;
    await _controller.close();
  }
}

void main() {
  late Directory root;
  late CurrencyCatalogView catalog;
  late CurrencyContentDocument banknote;
  late CurrencyContentDocument coin;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce5-tilt-');
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
    bool sensorAvailable = true,
    bool reduceMotion = false,
    TiltAnalytics? analytics,
    TiltSource? sensorSource,
  }) {
    return ProviderScope(
      overrides: [
        currencyCatalogViewProvider.overrideWith((ref) async => catalog),
        tiltAnalyticsProvider.overrideWithValue(
          analytics ?? _RecordingTiltAnalytics(),
        ),
      ],
      child: MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(disableAnimations: reduceMotion),
          child: child!,
        ),
        home: TiltViewerScreen(
          kind: kind,
          logicalId: document.logicalId,
          sensorAvailable: sensorAvailable,
          // Never the real sensor: a widget test has no plugin behind it, and
          // a scripted source is what makes the readings assertable anyway.
          sensorSource: sensorSource ?? _ScriptedTiltSource(),
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

  double renderedTilt(WidgetTester tester) =>
      tester.widget<TiltBanknoteView>(find.byType(TiltBanknoteView)).tilt;

  testWidgets('opens a mandatory banknote with its approved effect', (
    tester,
  ) async {
    await open(
      tester,
      subject(document: banknote, kind: CurrencyRouteKind.banknotes),
    );

    expect(find.byType(TiltBanknoteView), findsOneWidget);
    expect(find.text(banknote.title), findsOneWidget);
    expect(renderedTilt(tester), 0);
  });

  testWidgets('labels itself an educational simulation', (tester) async {
    await open(
      tester,
      subject(document: banknote, kind: CurrencyRouteKind.banknotes),
    );

    expect(find.textContaining('educational simulation'), findsOneWidget);
    expect(
      find.textContaining('do not reproduce any real banknote'),
      findsOneWidget,
    );
  });

  testWidgets('the effect follows the device as it is tilted', (tester) async {
    final sensor = _ScriptedTiltSource();
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        sensorSource: sensor,
      ),
    );

    expect(find.byType(Slider), findsNothing, reason: 'the sensor is driving');
    expect(find.textContaining('Tilt your device'), findsOneWidget);

    sensor.emit(-0.75);
    await tester.pumpAndSettle();
    expect(renderedTilt(tester), -0.75);

    sensor.emit(0.5);
    await tester.pumpAndSettle();
    expect(renderedTilt(tester), 0.5);
  });

  testWidgets('a device with no sensor drives the same effect from a slider', (
    tester,
  ) async {
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        sensorAvailable: false,
      ),
    );

    expect(find.textContaining('Drag the slider'), findsOneWidget);
    final slider = find.byType(Slider);
    expect(slider, findsOneWidget);
    // The slider sits below the illustration, so it can start off-screen.
    await tester.ensureVisible(slider);
    await tester.pumpAndSettle();

    await tester.drag(slider, const Offset(200, 0));
    await tester.pumpAndSettle();

    expect(renderedTilt(tester), greaterThan(0));
    expect(renderedTilt(tester), lessThanOrEqualTo(kApprovedTiltRange));
  });

  testWidgets('reduced motion moves the simulation onto the slider', (
    tester,
  ) async {
    final sensor = _ScriptedTiltSource();
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        reduceMotion: true,
        sensorSource: sensor,
      ),
    );

    // The feature stays usable: reduced motion changes where the value comes
    // from, it does not freeze the effect.
    expect(find.byType(Slider), findsOneWidget);
    expect(find.textContaining('Drag the slider'), findsOneWidget);

    sensor.emit(0.9);
    await tester.pumpAndSettle();
    expect(renderedTilt(tester), 0, reason: 'the sensor is not listened to');
  });

  testWidgets('records one feature_use for the note it opened', (tester) async {
    final analytics = _RecordingTiltAnalytics();
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        sensorAvailable: false,
        analytics: analytics,
      ),
    );

    expect(analytics.recorded, [banknote.logicalId]);

    await tester.ensureVisible(find.byType(Slider));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(Slider), const Offset(80, 0));
    await tester.pumpAndSettle();
    expect(
      analytics.recorded,
      hasLength(1),
      reason: 'tilting is not reopening',
    );
  });

  testWidgets('an item with no approved effect explains itself', (
    tester,
  ) async {
    final analytics = _RecordingTiltAnalytics();
    await open(
      tester,
      subject(
        document: coin,
        kind: CurrencyRouteKind.coins,
        analytics: analytics,
      ),
    );

    expect(find.byType(TiltBanknoteView), findsNothing);
    expect(find.text('Tilt Simulation Unavailable'), findsOneWidget);
    expect(analytics.recorded, isEmpty);
  });

  testWidgets('lets go of the sensor when the screen closes', (tester) async {
    final sensor = _ScriptedTiltSource();
    await open(
      tester,
      subject(
        document: banknote,
        kind: CurrencyRouteKind.banknotes,
        sensorSource: sensor,
      ),
    );

    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    await tester.pumpAndSettle();

    // A sensor left running is a battery cost the user cannot see.
    expect(sensor.disposed, isTrue);
  });

  testWidgets('describes the effect to a screen reader as a simulation', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await open(
      tester,
      subject(document: banknote, kind: CurrencyRouteKind.banknotes),
    );

    expect(
      find.bySemanticsLabel(
        RegExp('${banknote.tiltEffect!.label}.*educational simulation'),
      ),
      findsOneWidget,
    );
    handle.dispose();
  });
}
