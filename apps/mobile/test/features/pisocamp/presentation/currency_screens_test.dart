import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' show SemanticsAction;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/constants/api_constants.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/bundle_client.dart';
import 'package:mobile/features/pisocamp/data/bundle_store.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/currency_detail_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/currency_list_screen.dart';

import '../data/bundle_test_support.dart';

void main() {
  late Directory root;
  late CurrencyCatalogView catalog;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('ce1-ui-widget-');
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

  Widget listSubject({
    CurrencyRouteKind kind = CurrencyRouteKind.banknotes,
    required _FakeCurrencyBundleSync sync,
    CurrencyCatalogView? catalogOverride,
    bool connected = false,
    Stream<bool>? connectivity,
    MediaQueryData? mediaData,
  }) {
    final subjectCatalog = catalogOverride ?? catalog;
    return ProviderScope(
      overrides: [
        currencyCatalogViewProvider.overrideWith((ref) async => subjectCatalog),
        currencyBundleSyncProvider.overrideWith((ref) async => sync),
        connectivityStatusProvider.overrideWith(
          (ref) => connectivity ?? Stream<bool>.value(connected),
        ),
      ],
      child: MaterialApp(
        builder: mediaData == null
            ? null
            : (context, child) => MediaQuery(
                data: mediaData.copyWith(size: MediaQuery.sizeOf(context)),
                child: child ?? const SizedBox.shrink(),
              ),
        home: CurrencyListScreen(kind: kind, initialCatalog: subjectCatalog),
      ),
    );
  }

  testWidgets('list renders grouped ordered saved catalog while offline', (
    tester,
  ) async {
    final sync = _FakeCurrencyBundleSync();
    await tester.pumpWidget(listSubject(sync: sync));
    await tester.pumpAndSettle();

    expect(find.text('Banknotes'), findsOneWidget);
    expect(find.text('Offline — showing saved content'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('New Generation Currency Banknotes'),
      300,
    );
    expect(find.text('New Generation Currency Banknotes'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(sync.triggers, [BundleSyncTrigger.startup]);
  });

  testWidgets(
    'saved list stays visible through checking downloading and failure',
    (tester) async {
      final sync = _FakeCurrencyBundleSync();
      await tester.pumpWidget(listSubject(sync: sync, connected: true));
      await tester.pumpAndSettle();

      sync.emit(const BundleSyncState(phase: BundleSyncPhase.checking));
      await tester.pump();
      expect(find.text('Checking for updates'), findsOneWidget);
      expect(
        find.text(
          catalog.documentsFor(CurrencyRouteKind.banknotes).first.title,
        ),
        findsOneWidget,
      );

      sync.emit(const BundleSyncState(phase: BundleSyncPhase.downloading));
      await tester.pump();
      expect(
        find.text('Downloading update — showing saved content'),
        findsOneWidget,
      );
      expect(find.byType(CircularProgressIndicator), findsNothing);

      sync.emit(const BundleSyncState(phase: BundleSyncPhase.failed));
      await tester.pump();
      expect(
        find.text(
          'Saved content remains available. Connect to the internet and Retry to update.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
      await tester.pump();
      expect(sync.triggers.last, BundleSyncTrigger.manual);

      sync.emit(
        const BundleSyncState(phase: BundleSyncPhase.active, version: '0'),
      );
      await tester.pump();
      expect(find.text('Saved content is up to date'), findsOneWidget);
    },
  );

  testWidgets('reconnect starts the same serialized sync bridge', (
    tester,
  ) async {
    final connectivity = StreamController<bool>();
    addTearDown(connectivity.close);
    final sync = _FakeCurrencyBundleSync();
    await tester.pumpWidget(
      listSubject(sync: sync, connectivity: connectivity.stream),
    );
    connectivity.add(false);
    await tester.pumpAndSettle();
    connectivity.add(true);
    await tester.pumpAndSettle();

    expect(sync.triggers, [
      BundleSyncTrigger.startup,
      BundleSyncTrigger.connectivity,
    ]);
  });

  testWidgets('keyboard activation retries with a 48dp target', (tester) async {
    final sync = _FakeCurrencyBundleSync();
    await tester.pumpWidget(listSubject(sync: sync));
    await tester.pumpAndSettle();
    final retry = find.widgetWithText(FilledButton, 'Retry');
    expect(tester.getSize(retry).height, greaterThanOrEqualTo(48));

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(sync.triggers.last, BundleSyncTrigger.manual);
  });

  testWidgets(
    'paused error and success expose one live status and one Retry control',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final sync = _FakeCurrencyBundleSync();
      await tester.pumpWidget(listSubject(sync: sync, connected: true));
      await tester.pumpAndSettle();

      const transitions = [
        (
          BundleSyncState(phase: BundleSyncPhase.paused),
          'Offline \u2014 showing saved content',
        ),
        (
          BundleSyncState(phase: BundleSyncPhase.failed),
          'Saved content remains available. Connect to the internet and Retry to update.',
        ),
        (
          BundleSyncState(phase: BundleSyncPhase.active, version: '1'),
          'Saved content is up to date',
        ),
      ];
      for (final transition in transitions) {
        sync.emit(transition.$1);
        await tester.pump();
        final status = find.semantics.byLabel(transition.$2);
        expect(status, findsOne, reason: transition.$2);
        expect(status.found.single.label, transition.$2);
        expect(
          find.byWidgetPredicate(
            (widget) =>
                widget is Semantics &&
                widget.properties.liveRegion == true &&
                widget.properties.label == transition.$2,
          ),
          findsOneWidget,
        );
        expect(find.semantics.byLabel('Currency update status'), findsNothing);
        expect(
          find.byWidgetPredicate(
            (widget) => widget is Icon && widget.semanticLabel != null,
          ),
          findsNothing,
        );
        final retry = find.semantics.byLabel('Retry currency update');
        expect(retry, findsOne);
        final retryData = retry.found.single.getSemanticsData();
        expect(retryData.flagsCollection.isButton, isTrue);
        expect(retryData.hasAction(SemanticsAction.tap), isTrue);
        final triggerCount = sync.triggers.length;
        tester.semantics.tap(retry);
        await tester.pump();
        expect(sync.triggers.length, triggerCount + 1);
        expect(sync.triggers.last, BundleSyncTrigger.manual);
      }
      semantics.dispose();
    },
  );

  testWidgets('unavailable content exposes exactly one Retry button node', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final empty = await tester.runAsync(() => _emptyCatalog(root));
    expect(empty, isNotNull);
    final sync = _FakeCurrencyBundleSync();
    await tester.pumpWidget(listSubject(sync: sync, catalogOverride: empty));
    await tester.pumpAndSettle();

    final retries = find.semantics.byPredicate(
      (node) => node.label.contains('Retry'),
    );
    expect(retries, findsOne);
    final retry = find.semantics.byLabel('Retry currency update');
    expect(retry, findsOne);
    final retryData = retry.found.single.getSemanticsData();
    expect(retryData.flagsCollection.isButton, isTrue);
    expect(retryData.hasAction(SemanticsAction.tap), isTrue);
    tester.semantics.tap(retry);
    await tester.pump();
    expect(sync.triggers, [
      BundleSyncTrigger.startup,
      BundleSyncTrigger.manual,
    ]);
    semantics.dispose();
  });

  testWidgets(
    'detail uses verified image semantics and records one safe open',
    (tester) async {
      final analytics = _RecordingAnalytics();
      final document = catalog.documentsFor(CurrencyRouteKind.coins).first;
      final verified = await tester.runAsync(() => catalog.readImage(document));
      expect(verified, isNotNull);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            contentViewAnalyticsProvider.overrideWithValue(analytics),
          ],
          child: MaterialApp(
            home: CurrencyDetailScreen(
              kind: CurrencyRouteKind.coins,
              logicalId: document.logicalId,
              initialCatalog: catalog,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text(document.title), findsOneWidget);
      expect(find.text(document.summary), findsOneWidget);
      expect(find.text(document.body), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              widget.properties.image == true &&
              widget.properties.label == document.imageAlt,
        ),
        findsOneWidget,
      );
      expect(find.text('Bangko Sentral ng Pilipinas source'), findsOneWidget);
      expect(find.textContaining('https://www.bsp.gov.ph/'), findsOneWidget);
      expect(analytics.logicalIds, [document.logicalId]);

      await tester.binding.setSurfaceSize(const Size(320, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(analytics.logicalIds, [document.logicalId]);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets('slow analytics never delays verified detail rendering', (
    tester,
  ) async {
    final analytics = _DelayedAnalytics();
    final document = catalog.documentsFor(CurrencyRouteKind.coins).first;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [contentViewAnalyticsProvider.overrideWithValue(analytics)],
        child: MaterialApp(
          home: CurrencyDetailScreen(
            kind: CurrencyRouteKind.coins,
            logicalId: document.logicalId,
            initialCatalog: catalog,
          ),
        ),
      ),
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 30)),
    );
    await tester.pumpAndSettle();

    expect(find.text(document.title), findsOneWidget);
    expect(analytics.started, isTrue);
    expect(analytics.completed.isCompleted, isFalse);
    analytics.release.complete();
    await tester.pump();
  });

  testWidgets(
    'same logical route does not re-emit when catalog source changes',
    (tester) async {
      final analytics = _RecordingAnalytics();
      final document = catalog.documentsFor(CurrencyRouteKind.coins).last;
      final replacement = await tester.runAsync(() async {
        return CurrencyCatalogView.load(
          catalog.snapshot,
          seedBaseline: await CurrencySeedBaseline.load(loadSeedAsset),
        );
      });
      expect(replacement, isNotNull);

      Widget subject(CurrencyCatalogView source) => ProviderScope(
        overrides: [contentViewAnalyticsProvider.overrideWithValue(analytics)],
        child: MaterialApp(
          home: CurrencyDetailScreen(
            key: const ValueKey('stable-detail-route'),
            kind: CurrencyRouteKind.coins,
            logicalId: document.logicalId,
            initialCatalog: source,
          ),
        ),
      );

      await tester.pumpWidget(subject(catalog));
      await tester.pumpAndSettle();
      expect(analytics.logicalIds, [document.logicalId]);

      await tester.pumpWidget(subject(replacement!));
      await tester.pumpAndSettle();
      expect(find.text(document.title), findsOneWidget);
      expect(analytics.logicalIds, [document.logicalId]);
    },
  );

  testWidgets('throwing analytics leaves detail visible and reports safely', (
    tester,
  ) async {
    final reports = <(String, String)>[];
    final original = analyticsFailureReporter;
    addTearDown(() => analyticsFailureReporter = original);
    analyticsFailureReporter = (eventName, reason) {
      reports.add((eventName, reason));
    };
    final document = catalog.documentsFor(CurrencyRouteKind.coins).first;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          contentViewAnalyticsProvider.overrideWithValue(_ThrowingAnalytics()),
        ],
        child: MaterialApp(
          home: CurrencyDetailScreen(
            kind: CurrencyRouteKind.coins,
            logicalId: document.logicalId,
            initialCatalog: catalog,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(document.title), findsOneWidget);
    expect(find.text(document.body), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(reports, <(String, String)>[('content_view', 'unexpected')]);
    expect(reports.toString(), isNot(contains('private')));
  });

  testWidgets(
    'offline content view captures offline while detail stays usable',
    (tester) async {
      final queue = _RecordingEventQueue();
      final sdk = AnalyticsSdk(
        context: () async => const AnalyticsEventContext(
          subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
          sessionId: '123e4567-e89b-42d3-a456-426614174000',
          accountType: AnalyticsAccountType.guest,
          appVersion: '1.0.0+1',
          osName: AnalyticsOsName.android,
          osVersion: '14',
          deviceCategory: AnalyticsDeviceCategory.phone,
          networkState: AnalyticsNetworkState.offline,
        ),
        queue: () async => queue,
        scheduleSync: () async {},
        createEventId: () => '123e4567-e89b-42d3-a456-426614174001',
      );
      final document = catalog.documentsFor(CurrencyRouteKind.coins).first;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [analyticsSdkProvider.overrideWithValue(sdk)],
          child: MaterialApp(
            home: CurrencyDetailScreen(
              kind: CurrencyRouteKind.coins,
              logicalId: document.logicalId,
              initialCatalog: catalog,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text(document.title), findsOneWidget);
      expect(queue.events, hasLength(1));
      expect(queue.events.single.intent, isA<ContentViewIntent>());
      expect(
        queue.events.single.context.networkState,
        AnalyticsNetworkState.offline,
      );
    },
  );

  testWidgets('a coin detail offers the 3D view and a banknote does not', (
    tester,
  ) async {
    final coin = catalog.documentsFor(CurrencyRouteKind.coins).first;
    final banknote = catalog.documentsFor(CurrencyRouteKind.banknotes).first;
    final router = GoRouter(
      initialLocation: '/detail',
      routes: [
        GoRoute(
          path: '/detail',
          builder: (context, state) => CurrencyDetailScreen(
            kind: CurrencyRouteKind.coins,
            logicalId: coin.logicalId,
            initialCatalog: catalog,
          ),
        ),
        GoRoute(
          path: '/pisocamp/currency/:kind/:logicalId/3d',
          builder: (context, state) => Scaffold(
            body: Text('3D view of ${state.pathParameters['logicalId']}'),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(child: MaterialApp.router(routerConfig: router)),
    );
    await tester.pumpAndSettle();

    final entryPoint = find.widgetWithText(OutlinedButton, 'View in 3D');
    expect(entryPoint, findsOneWidget);
    expect(tester.getSize(entryPoint).height, greaterThanOrEqualTo(48));

    await tester.ensureVisible(entryPoint);
    await tester.pumpAndSettle();
    await tester.tap(entryPoint);
    await tester.pumpAndSettle();
    expect(find.text('3D view of ${coin.logicalId}'), findsOneWidget);

    // Banknote 3D is out of scope, so the button is absent rather than
    // present and leading to a notice.
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: CurrencyDetailScreen(
            kind: CurrencyRouteKind.banknotes,
            logicalId: banknote.logicalId,
            initialCatalog: catalog,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('View in 3D'), findsNothing);
  });

  testWidgets(
    'detail associates security features and exposes only safe destinations',
    (tester) async {
      final published = await tester.runAsync(() => _publishedCatalog(root));
      expect(published, isNotNull);
      const firstItemId = '11111111-1111-4111-8111-111111111111';
      final document = published!.resolve(
        CurrencyRouteKind.coins,
        'content.$firstItemId',
      )!;
      final router = GoRouter(
        initialLocation: '/detail',
        routes: [
          GoRoute(
            path: '/detail',
            builder: (context, state) => CurrencyDetailScreen(
              kind: CurrencyRouteKind.coins,
              logicalId: document.logicalId,
              initialCatalog: published,
            ),
          ),
          GoRoute(
            path: '/pisocamp/currency/:kind/:logicalId',
            builder: (context, state) => const Scaffold(
              body: Text('Validated related currency destination'),
            ),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(child: MaterialApp.router(routerConfig: router)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Security features'), findsOneWidget);
      expect(find.text('Verified educational feature'), findsOneWidget);
      expect(find.text('Protected profile'), findsNothing);
      final topic = find.widgetWithText(TextButton, 'Related five-peso coin');
      expect(topic, findsOneWidget);
      expect(tester.getSize(topic).height, greaterThanOrEqualTo(48));
      expect(find.textContaining('https://www.bsp.gov.ph/'), findsOneWidget);
      expect(
        find.textContaining('shown for reference'),
        findsAtLeastNWidgets(1),
      );

      // The coin detail now offers a 3D entry point above the related links,
      // so the topic button can start below the fold.
      await tester.ensureVisible(topic);
      await tester.pumpAndSettle();
      await tester.tap(topic);
      await tester.pumpAndSettle();
      expect(
        find.text('Validated related currency destination'),
        findsOneWidget,
      );
    },
  );

  testWidgets('detail fails closed on kind mismatch without analytics', (
    tester,
  ) async {
    final analytics = _RecordingAnalytics();
    final document = catalog.documentsFor(CurrencyRouteKind.coins).first;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [contentViewAnalyticsProvider.overrideWithValue(analytics)],
        child: MaterialApp(
          home: CurrencyDetailScreen(
            kind: CurrencyRouteKind.banknotes,
            logicalId: document.logicalId,
            initialCatalog: catalog,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Currency content unavailable'), findsOneWidget);
    expect(analytics.logicalIds, isEmpty);
    expect(find.text(document.title), findsNothing);
  });

  testWidgets(
    'same route pattern re-resolves A to B then fails closed on kind mismatch',
    (tester) async {
      final analytics = _RecordingAnalytics();
      final coins = catalog.documentsFor(CurrencyRouteKind.coins);
      final first = coins[0];
      final second = coins[1];
      final router = GoRouter(
        initialLocation:
            '/pisocamp/currency/coins/${Uri.encodeComponent(first.logicalId)}',
        routes: [
          GoRoute(
            path: '/pisocamp/currency/:kind/:logicalId',
            builder: (context, state) => CurrencyDetailScreen(
              kind: CurrencyRouteKind.fromPathSegment(
                state.pathParameters['kind']!,
              )!,
              logicalId: state.pathParameters['logicalId']!,
              initialCatalog: catalog,
            ),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            contentViewAnalyticsProvider.overrideWithValue(analytics),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(first.title), findsOneWidget);
      expect(analytics.logicalIds, [first.logicalId]);

      router.go(
        '/pisocamp/currency/coins/${Uri.encodeComponent(second.logicalId)}',
      );
      await tester.pumpAndSettle();
      expect(find.text(second.title), findsOneWidget);
      expect(find.text(first.title), findsNothing);
      expect(analytics.logicalIds, [first.logicalId, second.logicalId]);

      router.go(
        '/pisocamp/currency/banknotes/${Uri.encodeComponent(second.logicalId)}',
      );
      await tester.pumpAndSettle();
      expect(find.text('Currency content unavailable'), findsOneWidget);
      expect(find.text(second.title), findsNothing);
      expect(analytics.logicalIds, [first.logicalId, second.logicalId]);
    },
  );

  testWidgets(
    'null route extra captures current catalog once and remains pinned',
    (tester) async {
      final published = await tester.runAsync(() => _publishedCatalog(root));
      expect(published, isNotNull);
      final first = catalog.documentsFor(CurrencyRouteKind.coins).first;
      const publishedLogicalId = 'content.11111111-1111-4111-8111-111111111111';
      final second = published!.resolve(
        CurrencyRouteKind.coins,
        publishedLogicalId,
      )!;
      final analytics = _RecordingAnalytics();
      var currentCatalog = catalog;
      var catalogReads = 0;
      final container = ProviderContainer(
        overrides: [
          currencyCatalogViewProvider.overrideWith((ref) async {
            catalogReads += 1;
            return currentCatalog;
          }),
          contentViewAnalyticsProvider.overrideWithValue(analytics),
        ],
      );
      addTearDown(container.dispose);
      final router = GoRouter(
        initialLocation:
            '/pisocamp/currency/coins/${Uri.encodeComponent(first.logicalId)}',
        initialExtra: catalog,
        routes: [
          GoRoute(
            path: '/pisocamp/currency/:kind/:logicalId',
            builder: (context, state) => CurrencyDetailScreen(
              kind: CurrencyRouteKind.fromPathSegment(
                state.pathParameters['kind']!,
              )!,
              logicalId: state.pathParameters['logicalId']!,
              initialCatalog: state.extra as CurrencyCatalogView?,
            ),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(first.title), findsOneWidget);
      expect(analytics.logicalIds, [first.logicalId]);
      expect(catalogReads, 0);

      currentCatalog = published;
      container.invalidate(currencyCatalogViewProvider);
      router.go(
        '/pisocamp/currency/coins/${Uri.encodeComponent(second.logicalId)}',
      );
      await tester.pumpAndSettle();
      expect(find.text(second.title), findsOneWidget);
      expect(find.text(first.title), findsNothing);
      expect(analytics.logicalIds, [first.logicalId, second.logicalId]);
      expect(catalogReads, 1);

      currentCatalog = catalog;
      container.invalidate(currencyCatalogViewProvider);
      await tester.pumpAndSettle();
      expect(find.text(second.title), findsOneWidget);
      expect(analytics.logicalIds, [first.logicalId, second.logicalId]);
      expect(catalogReads, 1);
    },
  );

  testWidgets('detail fits landscape at 200 percent text with reduced motion', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(568, 320));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final document = catalog.documentsFor(CurrencyRouteKind.coins).first;
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
              disableAnimations: true,
            ),
            child: child!,
          ),
          home: CurrencyDetailScreen(
            kind: CurrencyRouteKind.coins,
            logicalId: document.logicalId,
            initialCatalog: catalog,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(document.title), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text(document.body), 200);
    expect(find.text(document.body), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('list retains state at 320px landscape and 200 percent text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final sync = _FakeCurrencyBundleSync();
    await tester.pumpWidget(
      listSubject(
        sync: sync,
        mediaData: const MediaQueryData(
          size: Size(320, 640),
          textScaler: TextScaler.linear(2),
          disableAnimations: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Banknotes'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics &&
            widget.properties.label == 'Retry currency update',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.text('Enhanced New Generation Currency Banknotes'),
      300,
    );
    await tester.binding.setSurfaceSize(const Size(568, 320));
    await tester.pump();
    expect(
      find.text('Enhanced New Generation Currency Banknotes'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

final class _FakeCurrencyBundleSync implements CurrencyBundleSync {
  final _states = StreamController<BundleSyncState>.broadcast(sync: true);
  final List<BundleSyncTrigger> triggers = [];
  BundleSyncState _state = const BundleSyncState.idle();

  @override
  BundleSyncState get state => _state;

  @override
  Stream<BundleSyncState> get states => _states.stream;

  void emit(BundleSyncState state) {
    _state = state;
    _states.add(state);
  }

  @override
  Future<void> sync(BundleSyncTrigger trigger) async {
    triggers.add(trigger);
  }
}

final class _RecordingAnalytics implements ContentViewAnalytics {
  final List<String> logicalIds = [];

  @override
  Future<void> recordOpen(String logicalId) async {
    logicalIds.add(logicalId);
  }
}

final class _DelayedAnalytics implements ContentViewAnalytics {
  final release = Completer<void>();
  final completed = Completer<void>();
  bool started = false;

  @override
  Future<void> recordOpen(String logicalId) async {
    started = true;
    await release.future;
    completed.complete();
  }
}

final class _ThrowingAnalytics implements ContentViewAnalytics {
  @override
  Future<void> recordOpen(String logicalId) async {
    throw StateError('private analytics failure');
  }
}

final class _RecordingEventQueue implements AnalyticsEventQueue {
  final List<AnalyticsEvent> events = <AnalyticsEvent>[];

  @override
  Future<void> enqueue(AnalyticsEvent event) async {
    events.add(event);
  }
}

Future<CurrencyCatalogView> _publishedCatalog(Directory root) async {
  const firstItemId = '11111111-1111-4111-8111-111111111111';
  const secondItemId = '22222222-2222-4222-8222-222222222222';
  final resources = <TestBundleResource>[
    _publishedResource(
      contentItemId: firstItemId,
      contentVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      contentType: 'coin',
      denominationCode: 'php-1',
      title: 'Published one-peso coin',
      relatedLinks: const [
        {
          'id': '44444444-4444-4444-8444-444444444444',
          'position': 0,
          'kind': 'internal',
          'label': 'Protected profile',
          'route': '/profile',
        },
        {
          'id': '55555555-5555-4555-8555-555555555555',
          'position': 1,
          'kind': 'topic',
          'label': 'Related five-peso coin',
          'targetContentItemId': secondItemId,
        },
      ],
    ),
    _publishedResource(
      contentItemId: secondItemId,
      contentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      contentType: 'coin',
      denominationCode: 'php-5',
      title: 'Published five-peso coin',
    ),
    _publishedResource(
      contentItemId: '33333333-3333-4333-8333-333333333333',
      contentVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      contentType: 'security_feature',
      denominationCode: 'php-1',
      title: 'Verified educational feature',
    ),
  ];
  final update = await TestSignedBundle.create(
    version: '1',
    resources: resources,
  );
  final mediaTypes = {
    for (final resource in resources) resource.digest: resource.mediaType,
  };
  final dio = Dio()
    ..httpClientAdapter = _MemoryBundleAdapter(
      resources: update.resources,
      mediaTypes: mediaTypes,
    );
  final versionedUrl = Uri.parse('https://bundle.test/api/v1');
  final client = BundleClient(dio: dio, versionedUrl: versionedUrl);
  try {
    final store = BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: update.keyRing,
      versionedUrl: versionedUrl,
    );
    final staged = await store.stage(
      envelope: update.envelope,
      envelopeBytes: update.envelopeBytes,
      client: client,
    );
    return CurrencyCatalogView.load(
      await store.activate(staged),
      seedBaseline: await CurrencySeedBaseline.load(loadSeedAsset),
    );
  } finally {
    client.close();
  }
}

TestBundleResource _publishedResource({
  required String contentItemId,
  required String contentVersionId,
  required String contentType,
  required String denominationCode,
  required String title,
  List<Map<String, Object?>> relatedLinks = const [],
}) {
  return TestBundleResource(
    logicalId: 'content.$contentItemId',
    contentItemId: contentItemId,
    contentVersionId: contentVersionId,
    bytes: Uint8List.fromList(
      utf8.encode(
        jsonEncode({
          'schemaVersion': 1,
          'logicalId': 'content.$contentItemId',
          'contentItemId': contentItemId,
          'contentVersionId': contentVersionId,
          'versionNo': 1,
          'contentType': contentType,
          'title': title,
          'summary': 'Verified saved educational summary.',
          'body': 'Verified saved educational body.',
          'seriesCode': 'ngc-coins',
          'denominationCode': denominationCode,
          'primaryUrl': null,
          'featureLevel': contentType == 'security_feature' ? 'first' : null,
          'hotspot': null,
          'relatedLinks': relatedLinks,
        }),
      ),
    ),
  );
}

final class _MemoryBundleAdapter implements HttpClientAdapter {
  const _MemoryBundleAdapter({
    required this.resources,
    required this.mediaTypes,
  });

  final Map<String, Uint8List> resources;
  final Map<String, String> mediaTypes;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final digest = options.uri.pathSegments.last;
    final bytes = resources[digest];
    final mediaType = mediaTypes[digest];
    if (bytes == null || mediaType == null) {
      return ResponseBody.fromString('', 404);
    }
    return ResponseBody(
      Stream.value(bytes),
      200,
      headers: {
        Headers.contentTypeHeader: [mediaType],
        Headers.contentLengthHeader: ['${bytes.length}'],
        'etag': ['"$digest"'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Future<CurrencyCatalogView> _emptyCatalog(Directory root) async {
  final invalid = TestBundleResource(
    logicalId: 'content.invalid',
    bytes: Uint8List.fromList(utf8.encode('{"not":"currency"}')),
  );
  final update = await TestSignedBundle.create(
    version: '1',
    resources: [invalid],
  );
  final dio = Dio()
    ..httpClientAdapter = _MemoryBundleAdapter(
      resources: update.resources,
      mediaTypes: {invalid.digest: invalid.mediaType},
    );
  final versionedUrl = Uri.parse('https://empty-bundle.test/api/v1');
  final client = BundleClient(dio: dio, versionedUrl: versionedUrl);
  try {
    final store = BundleStore(
      documentsRoot: root,
      loadAsset: loadSeedAsset,
      networkKeyRing: update.keyRing,
      versionedUrl: versionedUrl,
    );
    final staged = await store.stage(
      envelope: update.envelope,
      envelopeBytes: update.envelopeBytes,
      client: client,
    );
    return CurrencyCatalogView.load(await store.activate(staged));
  } finally {
    client.close();
  }
}
