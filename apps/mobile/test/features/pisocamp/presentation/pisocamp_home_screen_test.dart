import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_repository.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_home_screen.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';

void main() {
  const home = PisoCampHome(
    title: 'Piso CAMP',
    introduction: 'Guest-safe content',
    cards: <PisoCampHomeCard>[
      PisoCampHomeCard(title: 'Banknotes', description: 'Notes'),
      PisoCampHomeCard(title: 'Coins', description: 'Coins'),
    ],
  );

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  Widget subject({required bool offline, bool authenticated = false}) {
    return ProviderScope(
      overrides: [
        isAuthenticatedProvider.overrideWith((ref) => authenticated),
        requireConsentProvider.overrideWithValue(
          (context, purpose, {required online}) async => online
              ? ConsentGateResult.grantedSynced
              : ConsentGateResult.grantedQueued,
        ),
        guestIdentityServiceProvider.overrideWithValue(
          GuestIdentityService(SecureStorageService()),
        ),
        pisoCampHomeProvider.overrideWith(
          (ref) => Stream.value(
            PisoCampHomeLoadResult(home: home, isOffline: offline),
          ),
        ),
      ],
      child: const MaterialApp(home: PisoCampHomeScreen()),
    );
  }

  testWidgets('first unauthenticated entry offers optional account choices', (
    tester,
  ) async {
    await tester.pumpWidget(subject(offline: false));
    await tester.pumpAndSettle();

    expect(find.text('Create Account'), findsOneWidget);
    expect(find.text('Continue as Guest'), findsOneWidget);
    expect(find.textContaining('without an account'), findsOneWidget);
  });

  testWidgets('continuing as guest persists choice and closes the prompt', (
    tester,
  ) async {
    await tester.pumpWidget(subject(offline: false));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue as Guest'));
    await tester.pumpAndSettle();

    expect(find.text('Continue as Guest'), findsNothing);
    expect(find.text('Piso CAMP'), findsAtLeastNWidgets(1));
    expect(
      await GuestIdentityService(SecureStorageService()).hasContinuedAsGuest(),
      isTrue,
    );
  });

  testWidgets('authenticated entry does not show the account prompt', (
    tester,
  ) async {
    await tester.pumpWidget(subject(offline: false, authenticated: true));
    await tester.pumpAndSettle();

    expect(find.text('Create Account'), findsNothing);
    expect(find.text('Piso CAMP'), findsAtLeastNWidgets(1));
  });

  testWidgets('a repeated guest entry does not show the account prompt', (
    tester,
  ) async {
    await GuestIdentityService(SecureStorageService()).continueAsGuest();

    await tester.pumpWidget(subject(offline: false));
    await tester.pumpAndSettle();

    expect(find.text('Continue as Guest'), findsNothing);
  });

  testWidgets('online Create Account navigates to registration', (
    tester,
  ) async {
    final gate = Completer<ConsentGateResult>();
    final router = GoRouter(
      initialLocation: AppRoutes.pisoCamp,
      routes: [
        GoRoute(
          path: AppRoutes.pisoCamp,
          builder: (context, state) => const PisoCampHomeScreen(),
        ),
        GoRoute(
          path: AppRoutes.register,
          builder: (context, state) =>
              const Scaffold(body: Text('Registration route')),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
          requireConsentProvider.overrideWithValue((
            context,
            purpose, {
            required online,
          }) {
            expect(purpose, ConsentPurpose.registration);
            expect(online, isTrue);
            return gate.future;
          }),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(home: home, isOffline: false),
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Create Account'));
    await tester.pump();

    expect(find.text('Registration route'), findsNothing);
    gate.complete(ConsentGateResult.grantedSynced);
    await tester.pumpAndSettle();

    expect(find.text('Registration route'), findsOneWidget);
  });

  testWidgets('rapid Create Account taps run one complete consent gate', (
    tester,
  ) async {
    final storage = SecureStorageService();
    await storage.writeValue('device_pseudo_id', 'AbCdEfGhIjKlMnOpQrSt_-');
    final store = ConsentLocalStore(storage);
    final releaseStatus = Completer<void>();
    addTearDown(() {
      if (!releaseStatus.isCompleted) releaseStatus.complete();
    });
    final notice = PrivacyNotice(
      id: '8fa2d0d6-fce7-44db-b384-bb59d34bf40a',
      version: '2024-12-26',
      title: 'Privacy Notice',
      body: 'Explicit fake notice text for the serialized gate test.',
      sourceUrl: Uri.parse('https://example.test/privacy'),
      contentSha256:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      effectiveAt: DateTime.utc(2024, 12, 26),
    );
    final repository = _CountingConsentRepository(
      store,
      ConsentStatus(
        purpose: ConsentPurpose.registration,
        state: ConsentServerState.none,
        notice: notice,
      ),
      statusBarrier: releaseStatus.future,
    );
    final service = ConsentService(
      repository,
      store,
      GuestIdentityService(storage),
      idGenerator: () => 'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
      clock: () => DateTime.parse('2026-08-24T01:02:03.000Z'),
    );
    final observer = _PrivacyRouteObserver();
    final router = GoRouter(
      initialLocation: AppRoutes.pisoCamp,
      observers: [observer],
      routes: [
        GoRoute(
          path: AppRoutes.pisoCamp,
          builder: (context, state) => const PisoCampHomeScreen(),
        ),
        GoRoute(
          path: AppRoutes.register,
          builder: (context, state) =>
              const Scaffold(body: Text('Registration route')),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(storage),
          ),
          consentServiceProvider.overrideWithValue(service),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(home: home, isOffline: false),
            ),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Create Account'));
    await tester.tap(find.text('Create Account'));
    await tester.pump();

    expect(repository.statusChecks, 1);
    expect(observer.privacyRoutes, 0);
    releaseStatus.complete();
    await tester.pumpAndSettle();

    expect(observer.privacyRoutes, 1);
    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();
    expect(repository.syncedRecords, hasLength(1));
    expect(
      repository.syncedRecords.single.recordId,
      'bd7c903f-b547-4186-b5bd-292f91d2e4bb',
    );
    expect(find.text('Registration route'), findsOneWidget);
  });

  testWidgets('declining consent keeps non-dependent guest content available', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
          requireConsentProvider.overrideWithValue(
            (context, purpose, {required online}) async =>
                ConsentGateResult.declined,
          ),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(home: home, isOffline: false),
            ),
          ),
        ],
        child: const MaterialApp(home: PisoCampHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Create Account'));
    await tester.pumpAndSettle();

    expect(find.text('Banknotes'), findsOneWidget);
    expect(find.text('Coins'), findsAtLeastNWidgets(1));
    expect(find.byType(TextFormField), findsNothing);
  });

  testWidgets('fresh offline notice failure is clear and collects nothing', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
          requireConsentProvider.overrideWithValue(
            (context, purpose, {required online}) async =>
                ConsentGateResult.unavailable,
          ),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(home: home, isOffline: true),
            ),
          ),
        ],
        child: const MaterialApp(home: PisoCampHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Create Account'));
    await tester.pump();

    expect(
      find.text(
        'The privacy notice is unavailable. No information was collected.',
      ),
      findsOneWidget,
    );
    expect(find.byType(TextFormField), findsNothing);
  });

  testWidgets(
    'connectivity transitions gate account creation and update Offline',
    (tester) async {
      final connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      final router = GoRouter(
        initialLocation: AppRoutes.pisoCamp,
        routes: [
          GoRoute(
            path: AppRoutes.pisoCamp,
            builder: (context, state) => const PisoCampHomeScreen(),
          ),
          GoRoute(
            path: AppRoutes.register,
            builder: (context, state) =>
                const Scaffold(body: Text('Registration route')),
          ),
        ],
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            isAuthenticatedProvider.overrideWith((ref) => false),
            requireConsentProvider.overrideWithValue(
              (context, purpose, {required online}) async => online
                  ? ConsentGateResult.grantedSynced
                  : ConsentGateResult.grantedQueued,
            ),
            connectivityStatusProvider.overrideWith(
              (ref) => connectivity.stream,
            ),
            guestIdentityServiceProvider.overrideWithValue(
              GuestIdentityService(SecureStorageService()),
            ),
            pisoCampHomeProvider.overrideWith(
              (ref) => Stream.value(
                const PisoCampHomeLoadResult(home: home, isOffline: false),
              ),
            ),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      connectivity.add(true);
      await tester.pumpAndSettle();
      expect(find.text('Offline'), findsNothing);

      connectivity.add(false);
      await tester.pumpAndSettle();
      expect(find.text('Offline'), findsOneWidget);
      await tester.tap(find.text('Create Account'));
      await tester.pump();
      expect(
        find.text('Internet connection is required to create an account.'),
        findsOneWidget,
      );

      connectivity.add(true);
      await tester.pumpAndSettle();
      expect(find.text('Offline'), findsNothing);
      await tester.tap(find.text('Create Account'));
      await tester.pumpAndSettle();
      expect(find.text('Registration route'), findsOneWidget);
    },
  );

  testWidgets(
    'reconnect refreshes an offline home and trusts only a successful config',
    (tester) async {
      final connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      var serverReachable = false;
      var homeLoads = 0;
      final router = GoRouter(
        initialLocation: AppRoutes.pisoCamp,
        routes: [
          GoRoute(
            path: AppRoutes.pisoCamp,
            builder: (context, state) => const PisoCampHomeScreen(),
          ),
          GoRoute(
            path: AppRoutes.register,
            builder: (context, state) =>
                const Scaffold(body: Text('Registration route')),
          ),
        ],
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            isAuthenticatedProvider.overrideWith((ref) => false),
            requireConsentProvider.overrideWithValue(
              (context, purpose, {required online}) async => online
                  ? ConsentGateResult.grantedSynced
                  : ConsentGateResult.grantedQueued,
            ),
            connectivityStatusProvider.overrideWith(
              (ref) => connectivity.stream,
            ),
            guestIdentityServiceProvider.overrideWithValue(
              GuestIdentityService(SecureStorageService()),
            ),
            pisoCampHomeProvider.overrideWith((ref) {
              homeLoads += 1;
              return Stream.value(
                PisoCampHomeLoadResult(home: home, isOffline: !serverReachable),
              );
            }),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );

      connectivity.add(false);
      await tester.pumpAndSettle();
      expect(homeLoads, 1);
      expect(find.text('Offline'), findsOneWidget);

      connectivity.add(true);
      await tester.pumpAndSettle();
      expect(homeLoads, 2);
      expect(find.text('Offline'), findsOneWidget);
      await tester.tap(find.text('Create Account'));
      await tester.pump();
      expect(find.text('Registration route'), findsNothing);

      serverReachable = true;
      connectivity.add(false);
      await tester.pumpAndSettle();
      connectivity.add(true);
      await tester.pumpAndSettle();
      expect(homeLoads, 3);
      expect(find.text('Offline'), findsNothing);

      await tester.tap(find.text('Create Account'));
      await tester.pumpAndSettle();
      expect(find.text('Registration route'), findsOneWidget);
    },
  );

  testWidgets('disabled account prompt is not rendered', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(
                home: home,
                isOffline: false,
                accountPromptEnabled: false,
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: PisoCampHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Create Account'), findsNothing);
  });

  testWidgets('disabled module does not expose collection cards', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(
                home: home,
                isOffline: false,
                moduleEnabled: false,
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: PisoCampHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Banknotes'), findsNothing);
  });

  testWidgets('offline home exposes cards and an offline indicator', (
    tester,
  ) async {
    await tester.pumpWidget(subject(offline: true));
    await tester.pumpAndSettle();

    expect(find.text('Offline'), findsOneWidget);
    expect(find.text('Banknotes'), findsOneWidget);
    expect(find.text('Coins'), findsAtLeastNWidgets(1));
  });

  testWidgets('offline Create Account explains that internet is required', (
    tester,
  ) async {
    await tester.pumpWidget(subject(offline: true));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Create Account'));
    await tester.pump();

    expect(
      find.text('Internet connection is required to create an account.'),
      findsOneWidget,
    );
  });

  testWidgets('entry controls have button semantics and fit a narrow surface', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 720));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(subject(offline: false));
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Create Account'), findsAtLeastNWidgets(1));
    expect(find.bySemanticsLabel('Continue as Guest'), findsAtLeastNWidgets(1));
    expect(tester.takeException(), isNull);
  });
}

class _CountingConsentRepository extends ConsentRepository {
  _CountingConsentRepository(
    ConsentLocalStore store,
    this.status, {
    this.statusBarrier,
  }) : super(Dio(), store);

  final ConsentStatus status;
  final Future<void>? statusBarrier;
  int statusChecks = 0;
  final List<StoredConsentRecord> syncedRecords = <StoredConsentRecord>[];

  @override
  Future<ConsentStatus> fetchStatus(
    ConsentPurpose purpose, {
    required String devicePseudoId,
  }) async {
    statusChecks++;
    await statusBarrier;
    return status;
  }

  @override
  Future<RecordedConsentAcknowledgement> sync(
    StoredConsentRecord record,
  ) async {
    syncedRecords.add(record);
    return RecordedConsentAcknowledgement(
      id: record.recordId,
      state: ConsentServerState.granted,
      recordedAt: DateTime.utc(2026, 8, 24, 1, 2, 4),
    );
  }
}

class _PrivacyRouteObserver extends NavigatorObserver {
  int privacyRoutes = 0;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    if (route.settings.name?.startsWith('/pisocamp/privacy-notice/') == true) {
      privacyRoutes++;
    }
  }
}
