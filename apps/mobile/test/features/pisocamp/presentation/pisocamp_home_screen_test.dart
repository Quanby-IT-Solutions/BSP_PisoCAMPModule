import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/features/auth/data/models/session_model.dart';
import 'package:mobile/features/auth/data/models/user_model.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/data/analytics_event.dart';
import 'package:mobile/features/pisocamp/data/analytics_repository.dart';
import 'package:mobile/features/pisocamp/data/analytics_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/bundle_sync_controller.dart';
import 'package:mobile/features/pisocamp/data/consent_local_store.dart';
import 'package:mobile/features/pisocamp/data/consent_repository.dart';
import 'package:mobile/features/pisocamp/data/consent_service.dart';
import 'package:mobile/features/pisocamp/data/encrypted_analytics_queue.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_repository.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_profile_repository.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_registration_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/analytics_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:mobile/features/pisocamp/presentation/widgets/account_prompt.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_home_screen.dart';
import 'package:mobile/services/storage/secure_storage_service.dart';
import 'package:mobile/shared/widgets/app_button.dart';

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

  testWidgets('account prompt reports one first rendered shown boundary', (
    tester,
  ) async {
    var shown = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPrompt(
          onCreateAccount: null,
          onContinueAsGuest: () {},
          onShown: () => shown += 1,
        ),
      ),
    );
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPrompt(
          onCreateAccount: null,
          onContinueAsGuest: () {},
          onShown: () => shown += 1,
        ),
      ),
    );
    await tester.pump();

    expect(shown, 1);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPrompt(
          onCreateAccount: null,
          onContinueAsGuest: () {},
          onShown: () => shown += 1,
        ),
      ),
    );
    await tester.pump();

    expect(shown, 2);
  });

  Widget subject({
    required bool offline,
    bool authenticated = false,
    AnalyticsSdk? analyticsSdk,
    AnalyticsSdk Function(Ref)? analyticsSdkFactory,
    GuestIdentityService? guestIdentityService,
    Stream<bool>? connectivity,
    CurrencyBundleSync? currencySync,
    AnalyticsSyncController? analyticsController,
    Future<AnalyticsSyncController> Function(Ref)? analyticsControllerFactory,
    bool accountPromptEnabled = true,
  }) {
    final fallbackAnalytics = _testAnalyticsSdk(_AnalyticsQueue());
    return ProviderScope(
      overrides: [
        isAuthenticatedProvider.overrideWith((ref) => authenticated),
        pisoCampProfileStatusProvider.overrideWith((ref) async => null),
        requireConsentProvider.overrideWithValue(
          (context, purpose, {required online}) async => online
              ? ConsentGateResult.grantedSynced
              : ConsentGateResult.grantedQueued,
        ),
        guestIdentityServiceProvider.overrideWithValue(
          guestIdentityService ?? GuestIdentityService(SecureStorageService()),
        ),
        pisoCampHomeProvider.overrideWith(
          (ref) => Stream.value(
            PisoCampHomeLoadResult(
              home: home,
              isOffline: offline,
              accountPromptEnabled: accountPromptEnabled,
            ),
          ),
        ),
        if (analyticsSdkFactory != null)
          analyticsSdkProvider.overrideWith(analyticsSdkFactory)
        else
          analyticsSdkProvider.overrideWithValue(
            analyticsSdk ?? fallbackAnalytics,
          ),
        if (connectivity != null)
          connectivityStatusProvider.overrideWith((ref) => connectivity),
        if (currencySync != null)
          currencyBundleSyncProvider.overrideWith((ref) async => currencySync),
        if (analyticsControllerFactory != null)
          analyticsSyncControllerProvider.overrideWith(
            analyticsControllerFactory,
          )
        else if (analyticsController != null)
          analyticsSyncControllerProvider.overrideWith(
            (ref) async => analyticsController,
          ),
      ],
      child: const MaterialApp(home: PisoCampHomeScreen()),
    );
  }

  testWidgets('home records one module entry per mounted screen lifetime', (
    tester,
  ) async {
    final queue = _AnalyticsQueue();
    final sdk = _testAnalyticsSdk(queue);
    await tester.pumpWidget(subject(offline: false, analyticsSdk: sdk));
    await tester.pumpAndSettle();

    await tester.binding.setSurfaceSize(const Size(700, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pump();

    expect(
      queue.events.where((event) => event.intent is ModuleEntryIntent),
      hasLength(1),
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(subject(offline: false, analyticsSdk: sdk));
    await tester.pumpAndSettle();

    expect(
      queue.events.where((event) => event.intent is ModuleEntryIntent),
      hasLength(2),
    );
  });

  testWidgets('startup drain is independent when module analytics fails', (
    tester,
  ) async {
    final analyticsQueue = _RecordingAnalyticsQueuePort();
    final analyticsController = AnalyticsSyncController(
      queue: analyticsQueue,
      uploader: _UnusedAnalyticsUploader(),
      isOnline: () => true,
    );
    addTearDown(analyticsController.dispose);
    final previousReporter = analyticsFailureReporter;
    final diagnostics = <(String, String)>[];
    analyticsFailureReporter = (event, code) {
      diagnostics.add((event, code));
    };
    addTearDown(() => analyticsFailureReporter = previousReporter);

    await tester.pumpWidget(
      subject(
        offline: false,
        analyticsSdk: _failingAnalyticsSdk(),
        analyticsController: analyticsController,
      ),
    );
    await tester.pumpAndSettle();

    expect(analyticsQueue.reads, 1);
    expect(diagnostics, contains(('module_entry', 'unexpected')));
    expect(find.text('Banknotes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'startup drain survives synchronous module SDK construction failure',
    (tester) async {
      final analyticsQueue = _RecordingAnalyticsQueuePort();
      final analyticsController = AnalyticsSyncController(
        queue: analyticsQueue,
        uploader: _UnusedAnalyticsUploader(),
        isOnline: () => true,
      );
      addTearDown(analyticsController.dispose);
      final previousReporter = analyticsFailureReporter;
      final diagnostics = <(String, String)>[];
      analyticsFailureReporter = (event, code) {
        diagnostics.add((event, code));
      };
      addTearDown(() => analyticsFailureReporter = previousReporter);

      await tester.pumpWidget(
        subject(
          offline: false,
          accountPromptEnabled: false,
          analyticsSdkFactory: (ref) {
            throw StateError('private sdk construction failure');
          },
          analyticsController: analyticsController,
        ),
      );
      await tester.pumpAndSettle();

      expect(analyticsQueue.reads, 1);
      // The load timing is emitted at the first frame, so a broken SDK is
      // reported for it too rather than swallowed.
      expect(diagnostics, <(String, String)>[
        ('module_entry', 'unexpected'),
        // The install count and the load timing are both claimed at entry.
        ('first_open', 'unexpected'),
        ('module_load', 'unexpected'),
      ]);
      expect(diagnostics.toString(), isNot(contains('private')));
      expect(find.text('Banknotes'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('startup drain survives module enqueue failure', (tester) async {
    final analyticsQueue = _RecordingAnalyticsQueuePort();
    final analyticsController = AnalyticsSyncController(
      queue: analyticsQueue,
      uploader: _UnusedAnalyticsUploader(),
      isOnline: () => true,
    );
    addTearDown(analyticsController.dispose);
    final previousReporter = analyticsFailureReporter;
    final diagnostics = <(String, String)>[];
    analyticsFailureReporter = (event, code) {
      diagnostics.add((event, code));
    };
    addTearDown(() => analyticsFailureReporter = previousReporter);

    await tester.pumpWidget(
      subject(
        offline: false,
        accountPromptEnabled: false,
        analyticsSdk: _enqueueFailingAnalyticsSdk(),
        analyticsController: analyticsController,
      ),
    );
    await tester.pumpAndSettle();

    expect(analyticsQueue.reads, 1);
    expect(diagnostics, <(String, String)>[
      ('module_entry', 'enqueueFailed'),
      ('module_load', 'enqueueFailed'),
      ('first_open', 'enqueueFailed'),
    ]);
    expect(find.text('Banknotes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'synchronous analytics providers fail closed with stable diagnostics',
    (tester) async {
      final previousReporter = analyticsFailureReporter;
      final diagnostics = <(String, String)>[];
      analyticsFailureReporter = (event, code) {
        diagnostics.add((event, code));
      };
      addTearDown(() => analyticsFailureReporter = previousReporter);

      await tester.pumpWidget(
        subject(
          offline: false,
          analyticsSdkFactory: (ref) {
            throw StateError('private sdk construction failure');
          },
          analyticsControllerFactory: (ref) {
            throw StateError('private controller construction failure');
          },
        ),
      );
      await tester.pumpAndSettle();

      expect(diagnostics, <(String, String)>[
        ('module_entry', 'unexpected'),
        ('first_open', 'unexpected'),
        ('module_load', 'unexpected'),
        // The sync that could not start is itself a failure worth reporting.
        ('network_failure', 'unexpected'),
        ('module_entry', 'unexpected'),
        ('account_prompt_shown', 'unexpected'),
      ]);
      expect(diagnostics.toString(), isNot(contains('private')));
      expect(find.text('Banknotes'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('prompt shown follows rendered prompt lifetimes only', (
    tester,
  ) async {
    final queue = _AnalyticsQueue();
    final sdk = _testAnalyticsSdk(queue);
    await tester.pumpWidget(
      subject(offline: false, analyticsSdk: sdk, accountPromptEnabled: false),
    );
    await tester.pumpAndSettle();
    expect(
      queue.events.where((event) => event.intent is AccountPromptShownIntent),
      isEmpty,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(subject(offline: false, analyticsSdk: sdk));
    await tester.pumpAndSettle();
    await tester.binding.setSurfaceSize(const Size(500, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pump();
    expect(
      queue.events.where((event) => event.intent is AccountPromptShownIntent),
      hasLength(1),
    );

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pumpWidget(subject(offline: false, analyticsSdk: sdk));
    await tester.pumpAndSettle();
    expect(
      queue.events.where((event) => event.intent is AccountPromptShownIntent),
      hasLength(2),
    );
  });

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

  testWidgets('guest analytics waits for successful persistence', (
    tester,
  ) async {
    final queue = _AnalyticsQueue();
    final persistence = _ControlledGuestIdentityService();
    await tester.pumpWidget(
      subject(
        offline: false,
        analyticsSdk: _testAnalyticsSdk(queue),
        guestIdentityService: persistence,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue as Guest'));
    await tester.pump();
    expect(
      queue.events.where((event) => event.intent is AccountPromptGuestIntent),
      isEmpty,
    );
    expect(find.text('Continue as Guest'), findsOneWidget);

    persistence.complete();
    await tester.pumpAndSettle();
    expect(persistence.persisted, isTrue);
    expect(
      queue.events.where((event) => event.intent is AccountPromptGuestIntent),
      hasLength(1),
    );
    expect(find.text('Continue as Guest'), findsNothing);
  });

  testWidgets('rapid guest taps persist and emit exactly once', (tester) async {
    final queue = _AnalyticsQueue();
    final persistence = _ControlledGuestIdentityService();
    await tester.pumpWidget(
      subject(
        offline: false,
        analyticsSdk: _testAnalyticsSdk(queue),
        guestIdentityService: persistence,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue as Guest'));
    await tester.pump();

    final guestControl = find.widgetWithText(AppButton, 'Continue as Guest');
    expect(guestControl, findsOneWidget);
    expect(tester.widget<AppButton>(guestControl).onPressed, isNull);

    await tester.tap(find.text('Continue as Guest'));
    await tester.pump();

    expect(persistence.calls, 1);
    expect(
      queue.events.where((event) => event.intent is AccountPromptGuestIntent),
      isEmpty,
    );

    persistence.complete();
    await tester.pumpAndSettle();

    expect(persistence.calls, 1);
    expect(
      queue.events.where((event) => event.intent is AccountPromptGuestIntent),
      hasLength(1),
    );
  });

  testWidgets('guest persistence failure resets the continuation guard', (
    tester,
  ) async {
    final queue = _AnalyticsQueue();
    final persistence = _FailOnceGuestIdentityService();
    await tester.pumpWidget(
      subject(
        offline: false,
        analyticsSdk: _testAnalyticsSdk(queue),
        guestIdentityService: persistence,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue as Guest'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue as Guest'));
    await tester.pumpAndSettle();

    expect(persistence.calls, 2);
    expect(
      queue.events.where((event) => event.intent is AccountPromptGuestIntent),
      hasLength(1),
    );
    expect(find.text('Continue as Guest'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pending guest continuation is safe after unmount', (
    tester,
  ) async {
    final persistence = _ControlledGuestIdentityService();
    await tester.pumpWidget(
      subject(offline: false, guestIdentityService: persistence),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue as Guest'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    persistence.complete();
    await tester.pump();

    expect(persistence.calls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('guest storage failure emits nothing and keeps UI usable', (
    tester,
  ) async {
    final queue = _AnalyticsQueue();
    await tester.pumpWidget(
      subject(
        offline: false,
        analyticsSdk: _testAnalyticsSdk(queue),
        guestIdentityService: _FailingGuestIdentityService(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continue as Guest'));
    await tester.pump();
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(
      queue.events.where((event) => event.intent is AccountPromptGuestIntent),
      isEmpty,
    );
    expect(find.text('Continue as Guest'), findsOneWidget);
    expect(
      find.text('Unable to continue as guest. Please try again.'),
      findsOneWidget,
    );
    expect(find.text('Banknotes'), findsOneWidget);
  });

  testWidgets(
    'reconnect runs currency and analytics independently then disposes',
    (tester) async {
      final connectivity = StreamController<bool>();
      addTearDown(connectivity.close);
      final currencySync = _RecordingCurrencySync(failConnectivity: true);
      final analyticsQueue = _RecordingAnalyticsQueuePort();
      final analyticsController = AnalyticsSyncController(
        queue: analyticsQueue,
        uploader: _UnusedAnalyticsUploader(),
        isOnline: () => true,
      );
      addTearDown(analyticsController.dispose);
      await tester.pumpWidget(
        subject(
          offline: false,
          connectivity: connectivity.stream,
          currencySync: currencySync,
          analyticsController: analyticsController,
        ),
      );
      connectivity.add(false);
      await tester.pumpAndSettle();
      connectivity.add(true);
      await tester.pumpAndSettle();

      expect(currencySync.triggers, <BundleSyncTrigger>[
        BundleSyncTrigger.startup,
        BundleSyncTrigger.connectivity,
      ]);
      expect(analyticsQueue.reads, 2);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      connectivity.add(false);
      connectivity.add(true);
      await tester.pump();
      expect(currencySync.triggers, hasLength(2));
      expect(analyticsQueue.reads, 2);
    },
  );

  testWidgets(
    'offline module entry captures offline while content stays usable',
    (tester) async {
      final queue = _AnalyticsQueue();
      await tester.pumpWidget(
        subject(
          offline: true,
          analyticsSdk: _testAnalyticsSdk(
            queue,
            networkState: AnalyticsNetworkState.offline,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final entry = queue.events.singleWhere(
        (event) => event.intent is ModuleEntryIntent,
      );
      expect(entry.context.networkState, AnalyticsNetworkState.offline);
      expect(find.text('Offline'), findsOneWidget);
      expect(find.text('Banknotes'), findsOneWidget);
      expect(find.text('Coins'), findsAtLeastNWidgets(1));
    },
  );

  testWidgets('authenticated entry does not show the account prompt', (
    tester,
  ) async {
    await tester.pumpWidget(subject(offline: false, authenticated: true));
    await tester.pumpAndSettle();

    expect(find.text('Create Account'), findsNothing);
    expect(find.text('Piso CAMP'), findsAtLeastNWidgets(1));
  });

  testWidgets(
    'authenticated missing profile is prompted without account fields',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            isAuthenticatedProvider.overrideWith((ref) => true),
            pisoCampProfileStatusProvider.overrideWith(
              (ref) async => const PisoCampProfileResult(
                status: PisoCampProfileState.missing,
                missingFields: <String>[
                  'gender',
                  'age',
                  'regionCode',
                  'cityCode',
                ],
                name: 'Existing User',
                email: 'existing@example.com',
                profile: null,
              ),
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

      expect(find.text('Complete Piso CAMP profile'), findsOneWidget);
      expect(find.byType(TextFormField), findsNothing);
    },
  );

  testWidgets(
    'signed-in transition fetches missing profile and shows completion action',
    (tester) async {
      final auth = _TransitionAuthRepository();
      final profiles = _RetryProfileRepository();
      final container = ProviderContainer(
        overrides: [
          authRepositoryProvider.overrideWithValue(auth),
          pisoCampProfileRepositoryProvider.overrideWithValue(profiles),
          connectivityStatusProvider.overrideWith((ref) => Stream.value(true)),
          guestIdentityServiceProvider.overrideWithValue(
            GuestIdentityService(SecureStorageService()),
          ),
          pisoCampHomeProvider.overrideWith(
            (ref) => Stream.value(
              const PisoCampHomeLoadResult(home: home, isOffline: false),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: PisoCampHomeScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(profiles.profileGets, 0);

      final signIn = container
          .read(authStateProvider.notifier)
          .signIn(email: 'existing@example.test', password: 'test-password');
      await tester.pump();
      expect(profiles.profileGets, 0);

      auth.signInResult.complete(_session());
      await signIn;
      await tester.pumpAndSettle();

      expect(profiles.profileGets, 1);
      expect(find.text('Complete Piso CAMP profile'), findsOneWidget);
      expect(find.byType(TextFormField), findsNothing);
    },
  );

  testWidgets('profile load error is visible and retryable', (tester) async {
    final auth = _TransitionAuthRepository(restoredSession: _session());
    final profiles = _RetryProfileRepository(failFirst: true);
    final container = ProviderContainer(
      overrides: [
        authRepositoryProvider.overrideWithValue(auth),
        pisoCampProfileRepositoryProvider.overrideWithValue(profiles),
        connectivityStatusProvider.overrideWith((ref) => Stream.value(true)),
        guestIdentityServiceProvider.overrideWithValue(
          GuestIdentityService(SecureStorageService()),
        ),
        pisoCampHomeProvider.overrideWith(
          (ref) => Stream.value(
            const PisoCampHomeLoadResult(home: home, isOffline: false),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: PisoCampHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Piso CAMP profile is unavailable.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(profiles.profileGets, 1);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(profiles.profileGets, 2);
    expect(find.text('Complete Piso CAMP profile'), findsOneWidget);
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
          path: AppRoutes.pisoCampRegistration,
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
          path: AppRoutes.pisoCampRegistration,
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
            path: AppRoutes.pisoCampRegistration,
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
            path: AppRoutes.pisoCampRegistration,
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

  testWidgets('currency cards are 48dp semantic navigation controls', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(subject(offline: false));
    await tester.pumpAndSettle();

    final banknotes = find.byWidgetPredicate(
      (widget) =>
          widget is ListTile &&
          widget.title is Text &&
          (widget.title! as Text).data == 'Banknotes',
    );
    final coins = find.byWidgetPredicate(
      (widget) =>
          widget is ListTile &&
          widget.title is Text &&
          (widget.title! as Text).data == 'Coins',
    );
    expect(tester.getSize(banknotes).height, greaterThanOrEqualTo(48));
    expect(tester.getSize(coins).height, greaterThanOrEqualTo(48));
    expect(tester.getSemantics(banknotes).flagsCollection.isButton, isTrue);
    expect(tester.getSemantics(coins).flagsCollection.isButton, isTrue);
    semantics.dispose();
  });

  testWidgets('currency cards navigate to the exact guest list routes', (
    tester,
  ) async {
    final router = GoRouter(
      initialLocation: AppRoutes.pisoCamp,
      routes: [
        GoRoute(
          path: AppRoutes.pisoCamp,
          builder: (context, state) => const PisoCampHomeScreen(),
        ),
        GoRoute(
          path: AppRoutes.pisoCampBanknotes,
          builder: (context, state) =>
              const Scaffold(body: Text('Banknote list route')),
        ),
        GoRoute(
          path: AppRoutes.pisoCampCoins,
          builder: (context, state) =>
              const Scaffold(body: Text('Coin list route')),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          isAuthenticatedProvider.overrideWith((ref) => false),
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

    await tester.tap(
      find.byWidgetPredicate(
        (widget) =>
            widget is ListTile &&
            widget.title is Text &&
            (widget.title! as Text).data == 'Banknotes',
      ),
    );
    await tester.pumpAndSettle();
    expect(router.state.uri.path, AppRoutes.pisoCampBanknotes);
    expect(find.text('Banknote list route'), findsOneWidget);

    router.go(AppRoutes.pisoCamp);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byWidgetPredicate(
        (widget) =>
            widget is ListTile &&
            widget.title is Text &&
            (widget.title! as Text).data == 'Coins',
      ),
    );
    await tester.pumpAndSettle();
    expect(router.state.uri.path, AppRoutes.pisoCampCoins);
    expect(find.text('Coin list route'), findsOneWidget);
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

SessionModel _session() => const SessionModel(
  session: SessionData(token: 'test-session-token'),
  user: UserModel(
    id: 'existing-user',
    name: 'Existing User',
    email: 'existing@example.test',
  ),
);

class _TransitionAuthRepository implements AuthRepository {
  _TransitionAuthRepository({this.restoredSession});

  final SessionModel? restoredSession;
  final Completer<SessionModel?> signInResult = Completer<SessionModel?>();

  @override
  Future<SessionModel?> getSession() async => restoredSession;

  @override
  Future<SessionModel?> signIn({
    required String email,
    required String password,
  }) => signInResult.future;

  @override
  Future<AuthSignUpOutcome> signUp({
    required String email,
    required String password,
    required String name,
  }) => throw UnimplementedError();

  @override
  Future<void> signOut() async {}
}

class _RetryProfileRepository extends PisoCampProfileRepository {
  _RetryProfileRepository({this.failFirst = false}) : super(Dio());

  final bool failFirst;
  int profileGets = 0;

  @override
  Future<PisoCampProfileResult> fetchProfile() async {
    profileGets++;
    if (failFirst && profileGets == 1) {
      throw StateError('temporary profile failure');
    }
    return const PisoCampProfileResult(
      status: PisoCampProfileState.missing,
      missingFields: <String>['gender', 'age', 'regionCode', 'cityCode'],
      name: 'Existing User',
      email: 'existing@example.test',
      profile: null,
    );
  }
}

AnalyticsSdk _testAnalyticsSdk(
  _AnalyticsQueue queue, {
  AnalyticsNetworkState networkState = AnalyticsNetworkState.online,
}) => AnalyticsSdk(
  context: () async => AnalyticsEventContext(
    subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
    sessionId: '123e4567-e89b-42d3-a456-426614174000',
    accountType: AnalyticsAccountType.guest,
    appVersion: '1.0.0+1',
    osName: AnalyticsOsName.android,
    osVersion: '14',
    deviceCategory: AnalyticsDeviceCategory.phone,
    networkState: networkState,
  ),
  queue: () async => queue,
  scheduleSync: () async {},
  createEventId: () => '123e4567-e89b-42d3-a456-426614174001',
  clock: () => DateTime.utc(2026, 8, 31),
);

AnalyticsSdk _failingAnalyticsSdk() => AnalyticsSdk(
  context: () async {
    throw StateError('private module analytics failure');
  },
  queue: () async => _AnalyticsQueue(),
  scheduleSync: () async {},
);

AnalyticsSdk _enqueueFailingAnalyticsSdk() => AnalyticsSdk(
  context: () async => const AnalyticsEventContext(
    subjectPseudoId: 'AbCdEfGhIjKlMnOpQrSt_-',
    sessionId: '123e4567-e89b-42d3-a456-426614174000',
    accountType: AnalyticsAccountType.guest,
    appVersion: '1.0.0+1',
    osName: AnalyticsOsName.android,
    osVersion: '14',
    deviceCategory: AnalyticsDeviceCategory.phone,
    networkState: AnalyticsNetworkState.online,
  ),
  queue: () async => _FailingAnalyticsEventQueue(),
  scheduleSync: () async {},
  createEventId: () => '123e4567-e89b-42d3-a456-426614174001',
  clock: () => DateTime.utc(2026, 8, 31),
);

final class _AnalyticsQueue implements AnalyticsEventQueue {
  final List<AnalyticsEvent> events = <AnalyticsEvent>[];

  @override
  Future<void> enqueue(AnalyticsEvent event) async {
    events.add(event);
  }
}

final class _FailingAnalyticsEventQueue implements AnalyticsEventQueue {
  @override
  Future<void> enqueue(AnalyticsEvent event) {
    throw AnalyticsQueueException('enqueueFailed');
  }
}

final class _ControlledGuestIdentityService extends GuestIdentityService {
  _ControlledGuestIdentityService() : super(SecureStorageService());

  final _release = Completer<void>();
  bool persisted = false;
  int calls = 0;

  @override
  Future<bool> hasContinuedAsGuest() async => false;

  @override
  Future<void> continueAsGuest() async {
    calls += 1;
    await _release.future;
    persisted = true;
  }

  void complete() => _release.complete();
}

final class _FailOnceGuestIdentityService extends GuestIdentityService {
  _FailOnceGuestIdentityService() : super(SecureStorageService());

  int calls = 0;

  @override
  Future<bool> hasContinuedAsGuest() async => false;

  @override
  Future<void> continueAsGuest() async {
    calls += 1;
    if (calls == 1) {
      throw StateError('private first storage failure');
    }
  }
}

final class _FailingGuestIdentityService extends GuestIdentityService {
  _FailingGuestIdentityService() : super(SecureStorageService());

  @override
  Future<bool> hasContinuedAsGuest() async => false;

  @override
  Future<void> continueAsGuest() async {
    throw StateError('private storage failure');
  }
}

final class _RecordingCurrencySync implements CurrencyBundleSync {
  _RecordingCurrencySync({required this.failConnectivity});

  final bool failConnectivity;
  final List<BundleSyncTrigger> triggers = <BundleSyncTrigger>[];

  @override
  BundleSyncState get state => const BundleSyncState.idle();

  @override
  Stream<BundleSyncState> get states => const Stream.empty();

  @override
  Future<void> sync(BundleSyncTrigger trigger) async {
    triggers.add(trigger);
    if (failConnectivity && trigger == BundleSyncTrigger.connectivity) {
      throw StateError('private currency sync failure');
    }
  }
}

final class _RecordingAnalyticsQueuePort implements AnalyticsQueuePort {
  int reads = 0;

  @override
  Future<void> acknowledge(Iterable<String> eventIds) async {}

  @override
  Future<List<AnalyticsEvent>> readBatch({
    int maxEvents = 100,
    int maxBytes = 512 * 1024,
  }) async {
    reads += 1;
    return const <AnalyticsEvent>[];
  }
}

final class _UnusedAnalyticsUploader implements AnalyticsUploadPort {
  @override
  Future<List<String>> upload(List<AnalyticsEvent> events) {
    throw StateError('upload should not be called for an empty queue');
  }
}
