import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/core/network/connectivity_provider.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/pisocamp/data/guest_identity_service.dart';
import 'package:mobile/features/pisocamp/data/pisocamp_repository.dart';
import 'package:mobile/features/pisocamp/presentation/providers/pisocamp_provider.dart';
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
    await tester.pumpAndSettle();

    expect(find.text('Registration route'), findsOneWidget);
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
