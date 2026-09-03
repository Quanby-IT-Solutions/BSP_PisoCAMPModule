import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/ar_session.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/ar_experience_screen.dart';

class _RecordingQueue implements AnalyticsEventQueue {
  final List<AnalyticsEvent> events = <AnalyticsEvent>[];

  @override
  Future<void> enqueue(AnalyticsEvent event) async => events.add(event);
}

class _SupportedProbe implements ArCapabilityProbe {
  @override
  Future<ArCapability> check() async => const ArCapability.supported();
}

class _UnsupportedProbe implements ArCapabilityProbe {
  const _UnsupportedProbe(this.reason);

  final ArUnavailableReason reason;

  @override
  Future<ArCapability> check() async => ArCapability.unsupported(reason);
}

class _FakeSession implements ArSession {
  _FakeSession(this.log);

  final List<String> log;
  var disposals = 0;

  @override
  Future<void> get ready async => log.add('ready');

  @override
  Future<void> dispose() async {
    disposals += 1;
    log.add('disposed');
  }
}

class _FakeSessionFactory implements ArSessionFactory {
  _FakeSessionFactory(this.log);

  final List<String> log;
  final List<_FakeSession> sessions = <_FakeSession>[];

  @override
  Future<ArSession> start({required String logicalId}) async {
    log.add('start:$logicalId');
    final session = _FakeSession(log);
    sessions.add(session);
    return session;
  }
}

class _RefusingSessionFactory implements ArSessionFactory {
  const _RefusingSessionFactory(this.reason);

  final ArUnavailableReason reason;

  @override
  Future<ArSession> start({required String logicalId}) async =>
      throw ArSessionException(reason);
}

void main() {
  late _RecordingQueue queue;

  setUp(() {
    queue = _RecordingQueue();
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    required ArCapabilityProbe probe,
    required ArSessionFactory sessions,
    DateTime Function()? clock,
  }) async {
    final router = GoRouter(
      initialLocation: '/ar',
      routes: [
        GoRoute(
          path: '/ar',
          builder: (context, state) => ArExperienceScreen(
            kind: CurrencyRouteKind.coins,
            logicalId: 'catalog.ngc-coins.php-20',
            probe: probe,
            sessions: sessions,
            clock: clock,
          ),
        ),
        GoRoute(
          path: '/pisocamp/currency/coins/:logicalId/3d',
          builder: (context, state) => const Scaffold(body: Text('3D viewer')),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          analyticsSdkProvider.overrideWithValue(
            AnalyticsSdk(
              context: () async => const AnalyticsEventContext(
                subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
                sessionId: '123e4567-e89b-42d3-a456-426614174000',
                accountType: AnalyticsAccountType.guest,
                appVersion: '1.0.0+1',
                osName: AnalyticsOsName.android,
                osVersion: '15',
                deviceCategory: AnalyticsDeviceCategory.phone,
                networkState: AnalyticsNetworkState.online,
              ),
              queue: () async => queue,
              scheduleSync: () async {},
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
  }

  List<String> eventNames() =>
      queue.events.map((event) => event.toJson()['eventName']! as String).toList();

  testWidgets('explains why the camera is needed before the phone asks', (
    tester,
  ) async {
    final log = <String>[];
    final sessions = _FakeSessionFactory(log);
    await pumpScreen(tester, probe: _SupportedProbe(), sessions: sessions);

    expect(find.text('Before the camera opens'), findsOneWidget);
    // Nothing has been started, so the OS prompt has not happened either.
    expect(log, isEmpty);
    expect(
      find.textContaining('nothing is recorded, saved or sent anywhere'),
      findsOneWidget,
    );
  });

  testWidgets('starts the session and shows instructions once permitted', (
    tester,
  ) async {
    final log = <String>[];
    final sessions = _FakeSessionFactory(log);
    await pumpScreen(tester, probe: _SupportedProbe(), sessions: sessions);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(log, <String>['start:catalog.ngc-coins.php-20', 'ready']);
    expect(find.text('Move your phone slowly'), findsOneWidget);
    expect(find.text('Exit'), findsOneWidget);
    expect(eventNames(), <String>['ar_start']);
  });

  testWidgets('offers the 3D viewer when the device cannot run AR', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      probe: const _UnsupportedProbe(ArUnavailableReason.deviceUnsupported),
      sessions: _FakeSessionFactory(<String>[]),
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(find.text('This phone does not support augmented reality.'), findsOneWidget);
    await tester.tap(find.text('Open the 3D viewer'));
    await tester.pumpAndSettle();

    // A dead end here would strand somebody who came to look at a coin.
    expect(find.text('3D viewer'), findsOneWidget);
  });

  testWidgets('says so plainly when permission is refused', (tester) async {
    await pumpScreen(
      tester,
      probe: _SupportedProbe(),
      sessions: const _RefusingSessionFactory(
        ArUnavailableReason.permissionDenied,
      ),
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Without camera access'),
      findsOneWidget,
    );
    // The refusal is reported as a refusal, not as an unsupported device: the
    // two mean different things to whoever reads the figures.
    final properties =
        queue.events.single.toJson()['properties']! as Map<String, Object?>;
    expect(properties['outcome'], 'permission_denied');
  });

  testWidgets('a build with no AR runtime falls back rather than opening a blank camera', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      probe: const UnavailableArCapabilityProbe(),
      sessions: const UnavailableArSessionFactory(),
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(
      find.text('This build cannot open augmented reality yet.'),
      findsOneWidget,
    );
    expect(find.text('Open the 3D viewer'), findsOneWidget);
  });

  testWidgets('reports how long the session ran when it ends', (tester) async {
    var now = DateTime.utc(2026, 9, 3, 10);
    final log = <String>[];
    final sessions = _FakeSessionFactory(log);
    await pumpScreen(
      tester,
      probe: _SupportedProbe(),
      sessions: sessions,
      clock: () => now,
    );

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    now = now.add(const Duration(seconds: 42));
    await tester.tap(find.text('Exit'));
    await tester.pumpAndSettle();

    expect(eventNames(), <String>['ar_start', 'ar_end']);
    final ended = queue.events.last.toJson()['properties']! as Map<String, Object?>;
    expect(ended['durationMs'], 42000);
    expect(sessions.sessions.single.disposals, 1);
  });

  testWidgets('releases the session on every one of ten open and close cycles', (
    tester,
  ) async {
    // AR-005: ten cycles with nothing accumulating. What a widget test can
    // prove is that each session is started once and disposed once, and that
    // none outlives its screen; memory growth on a device is measured on a
    // device.
    final log = <String>[];
    final sessions = _FakeSessionFactory(log);

    for (var cycle = 0; cycle < 10; cycle += 1) {
      await pumpScreen(tester, probe: _SupportedProbe(), sessions: sessions);
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Exit'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    }

    expect(sessions.sessions, hasLength(10));
    expect(
      sessions.sessions.every((session) => session.disposals == 1),
      isTrue,
      reason: 'every session is released exactly once',
    );
    expect(eventNames().where((name) => name == 'ar_start'), hasLength(10));
    expect(eventNames().where((name) => name == 'ar_end'), hasLength(10));
  });

  testWidgets('reports the end once even when exit and disposal both happen', (
    tester,
  ) async {
    final log = <String>[];
    final sessions = _FakeSessionFactory(log);
    await pumpScreen(tester, probe: _SupportedProbe(), sessions: sessions);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Exit'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();

    // A session counted twice would halve every average built on it.
    expect(eventNames().where((name) => name == 'ar_end'), hasLength(1));
  });

  testWidgets('every control is reachable and 48dp on a narrow screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await pumpScreen(
      tester,
      probe: const _UnsupportedProbe(ArUnavailableReason.deviceUnsupported),
      sessions: _FakeSessionFactory(<String>[]),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    for (final label in <String>['Open the 3D viewer', 'Exit']) {
      final size = tester.getSize(find.widgetWithText(SizedBox, label).first);
      expect(size.height, greaterThanOrEqualTo(48));
    }
    expect(tester.takeException(), isNull);
  });
}
