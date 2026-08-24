import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:mobile/core/constants/sentry_constants.dart';
import 'package:mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:mobile/features/auth/presentation/screens/login_screen.dart';
import 'package:mobile/features/auth/presentation/screens/register_screen.dart';
import 'package:mobile/features/home/presentation/screens/home_screen.dart';
import 'package:mobile/features/onboarding/presentation/providers/onboarding_provider.dart';
import 'package:mobile/features/onboarding/presentation/screens/onboarding_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_home_screen.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

part 'app_router.g.dart';

/// Named route paths used across the app.
class AppRoutes {
  AppRoutes._();

  static const onboarding = '/onboarding';
  static const login = '/login';
  static const register = '/register';
  static const home = '/';
  static const pisoCamp = '/pisocamp';
}

String? resolveAppRedirect({
  required bool isOnboardingDone,
  required bool isAuthenticated,
  required String matchedLocation,
}) {
  final onboarding = matchedLocation == AppRoutes.onboarding;
  final auth =
      matchedLocation == AppRoutes.login ||
      matchedLocation == AppRoutes.register;
  if (!isOnboardingDone) {
    return onboarding ? null : AppRoutes.onboarding;
  }
  if (onboarding) {
    return isAuthenticated ? AppRoutes.home : AppRoutes.login;
  }
  if (!isAuthenticated) {
    return auth || matchedLocation == AppRoutes.pisoCamp
        ? null
        : AppRoutes.login;
  }
  return auth ? AppRoutes.home : null;
}

/// Provides the [GoRouter] instance configured with redirect logic
/// based on onboarding and authentication state.
///
/// Uses [refreshListenable] so the **same** GoRouter instance re-evaluates
/// its redirect whenever auth or onboarding state changes, instead of
/// recreating the router (which would not trigger a navigation).
@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  // A notifier that fires whenever auth or onboarding state changes,
  // telling GoRouter to re-run its redirect callback.
  final refreshNotifier = ValueNotifier<int>(0);

  ref.listen(authStateProvider, (_, _) {
    refreshNotifier.value++;
  });
  ref.listen(hasCompletedOnboardingProvider, (_, _) {
    refreshNotifier.value++;
  });

  final router = GoRouter(
    initialLocation: AppRoutes.home,
    debugLogDiagnostics: true,
    refreshListenable: refreshNotifier,
    // Route names become navigation breadcrumbs, so a crash report shows the
    // screens the user passed through. The list is empty in a build without
    // the Sentry defines — no observer is constructed at all.
    observers: [if (SentryConstants.isEnabled) SentryNavigatorObserver()],
    redirect: (context, state) {
      final isOnboardingDone = ref.read(hasCompletedOnboardingProvider);
      final authState = ref.read(authStateProvider);
      final isAuthenticated = !authState.isLoading && authState.value != null;
      return resolveAppRedirect(
        isOnboardingDone: isOnboardingDone,
        isAuthenticated: isAuthenticated,
        matchedLocation: state.matchedLocation,
      );
    },
    routes: [
      GoRoute(
        path: AppRoutes.onboarding,
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.register,
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.pisoCamp,
        builder: (context, state) => const PisoCampHomeScreen(),
      ),
    ],
    errorBuilder: (context, state) =>
        Scaffold(body: Center(child: Text('Page not found: ${state.uri}'))),
  );

  ref.onDispose(() {
    refreshNotifier.dispose();
    router.dispose();
  });

  return router;
}
