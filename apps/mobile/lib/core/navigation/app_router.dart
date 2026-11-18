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
import 'package:mobile/features/pisocamp/data/deep_links.dart';
import 'package:mobile/features/pisocamp/data/preview_build.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_home_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_preview_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/pisocamp_registration_screen.dart';
import 'package:mobile/features/pisocamp/presentation/providers/currency_catalog_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/coin_model.dart';
import 'package:mobile/features/pisocamp/data/ar_runtime.dart';
import 'package:mobile/features/pisocamp/data/recognition_engine.dart';
import 'package:mobile/features/pisocamp/presentation/providers/recognition_provider.dart';
import 'package:mobile/features/pisocamp/presentation/screens/recognition_scanner_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/ar_experience_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/coin_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/currency_detail_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/tactile_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/tilt_viewer_screen.dart';
import 'package:mobile/features/pisocamp/presentation/screens/currency_list_screen.dart';
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
  static const pisoCampRegistration = '/pisocamp/register';
  static const pisoCampBanknotes = '/pisocamp/currency/banknotes';
  static const pisoCampCoins = '/pisocamp/currency/coins';

  /// Present only in a BSP-approved preview build (see [kPisoCampPreviewBuild]).
  static const pisoCampPreview = '/pisocamp/preview';

  /// DR-1's banknote reader. Guest content: it identifies a denomination and
  /// says, every time, that it is not an authenticity check.
  static const pisoCampRecognition = '/pisocamp/recognition';

  static String currencyDetail({
    required String kind,
    required String logicalId,
  }) {
    if (CurrencyRouteKind.fromPathSegment(kind) == null) {
      throw ArgumentError.value(kind, 'kind', 'Unsupported currency kind');
    }
    if (!isValidCurrencyLogicalId(logicalId)) {
      throw ArgumentError.value(
        logicalId,
        'logicalId',
        'Invalid currency logical ID',
      );
    }
    return '/pisocamp/currency/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(logicalId)}';
  }

  /// The 3D view of one denomination. Only coins carry a model; the screen
  /// itself explains the fallback for anything that does not.
  static String currencyModel({
    required String kind,
    required String logicalId,
  }) {
    return '${currencyDetail(kind: kind, logicalId: logicalId)}/3d';
  }

  /// AR-1's augmented-reality view of one denomination. The screen itself
  /// explains an unsupported device and offers the 3D viewer instead.
  static String currencyAr({required String kind, required String logicalId}) {
    return '${currencyDetail(kind: kind, logicalId: logicalId)}/ar';
  }

  /// The tactile simulation for one denomination. Banknotes only carry a map;
  /// the screen itself explains anything that does not.
  static String currencyTactile({
    required String kind,
    required String logicalId,
  }) {
    return '${currencyDetail(kind: kind, logicalId: logicalId)}/tactile';
  }

  /// The tilt simulation for one denomination.
  static String currencyTilt({
    required String kind,
    required String logicalId,
  }) {
    return '${currencyDetail(kind: kind, logicalId: logicalId)}/tilt';
  }
}

bool isGuestCurrencyRoute(String matchedLocation) {
  if (matchedLocation == AppRoutes.pisoCampBanknotes ||
      matchedLocation == AppRoutes.pisoCampCoins) {
    return true;
  }
  final match = RegExp(
    r'^/pisocamp/currency/(banknotes|coins)/([^/]+)(?:/3d|/ar|/tactile|/tilt)?$',
  ).firstMatch(matchedLocation);
  if (match == null) return false;
  final segment = match.group(2)!;
  try {
    final decoded = Uri.decodeComponent(segment);
    if (!isValidCurrencyLogicalId(decoded)) return false;
    return segment == decoded || Uri.encodeComponent(decoded) == segment;
  } on FormatException {
    return false;
  }
}

/// Translates a location that arrived as an approved deep link into the app
/// route it means, or returns null when it is already an app route.
///
/// Flutter hands the router the incoming link's *path*, so the same path can
/// have arrived as `https://www.bsp.gov.ph/pisocamp/...` or as
/// `bsp://pisocamp/...`. Both are rebuilt and run through the one resolver, so
/// there is a single place that decides what a link means, and it never
/// produces a route this build does not already have.
String? resolvePisoCampIncomingLink(String location) {
  if (!location.startsWith('/')) return null;

  final candidates = <String>['https://$kPisoCampLinkHost$location'];
  // The custom-scheme reading is only attempted for a path that names a
  // currency kind. Without that restriction any in-app location — '/' most of
  // all — could be reinterpreted as a link and hijacked, because a bare path
  // does not say which scheme it arrived under.
  final first = Uri.parse(
    location,
  ).pathSegments.where((segment) => segment.isNotEmpty).firstOrNull;
  if (first != null && CurrencyRouteKind.fromPathSegment(first) != null) {
    candidates.add('$kPisoCampLinkScheme://$kPisoCampLinkPathPrefix$location');
  }

  for (final candidate in candidates) {
    final link = resolvePisoCampDeepLink(Uri.parse(candidate));
    if (link == null) continue;
    return link.route == location ? null : link.route;
  }
  return null;
}

String? resolveAppRedirect({
  required bool isOnboardingDone,
  required bool isAuthenticated,
  required String matchedLocation,
}) {
  // An approved link becomes an app route before anything else looks at it,
  // so the guards below only ever see locations this build owns.
  final incoming = resolvePisoCampIncomingLink(matchedLocation);
  if (incoming != null) return incoming;

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
    return auth ||
            matchedLocation == AppRoutes.pisoCamp ||
            matchedLocation == AppRoutes.pisoCampRegistration ||
            // DR-1 is a guest feature: somebody holding a note they cannot
            // place should not be asked to sign in first.
            matchedLocation == AppRoutes.pisoCampRecognition ||
            // Preview builds are internal by construction; the grant, not a
            // session, is what authorises the render.
            (kPisoCampPreviewBuild &&
                matchedLocation == AppRoutes.pisoCampPreview) ||
            isGuestCurrencyRoute(matchedLocation)
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
      GoRoute(
        path: AppRoutes.pisoCampRegistration,
        builder: (context, state) => const PisoCampRegistrationScreen(),
      ),
      if (kPisoCampPreviewBuild)
        GoRoute(
          path: AppRoutes.pisoCampPreview,
          builder: (context, state) => PisoCampPreviewScreen(
            initialCode: state.uri.queryParameters['token'],
          ),
        ),
      GoRoute(
        path: '/pisocamp/currency/:kind',
        builder: (context, state) {
          final kind = CurrencyRouteKind.fromPathSegment(
            state.pathParameters['kind'] ?? '',
          );
          return kind == null
              ? const _SafeNotFoundScreen()
              : CurrencyListScreen(kind: kind);
        },
      ),
      GoRoute(
        path: '/pisocamp/currency/:kind/:logicalId/tilt',
        builder: (context, state) {
          final kind = CurrencyRouteKind.fromPathSegment(
            state.pathParameters['kind'] ?? '',
          );
          final logicalId = state.pathParameters['logicalId'] ?? '';
          if (kind == null || !isValidCurrencyLogicalId(logicalId)) {
            return const _SafeNotFoundScreen();
          }
          return TiltViewerScreen(
            kind: kind,
            logicalId: logicalId,
            initialCatalog: state.extra is CurrencyCatalogView
                ? state.extra! as CurrencyCatalogView
                : null,
          );
        },
      ),
      GoRoute(
        path: '/pisocamp/currency/:kind/:logicalId/tactile',
        builder: (context, state) {
          final kind = CurrencyRouteKind.fromPathSegment(
            state.pathParameters['kind'] ?? '',
          );
          final logicalId = state.pathParameters['logicalId'] ?? '';
          if (kind == null || !isValidCurrencyLogicalId(logicalId)) {
            return const _SafeNotFoundScreen();
          }
          return TactileViewerScreen(
            kind: kind,
            logicalId: logicalId,
            initialCatalog: state.extra is CurrencyCatalogView
                ? state.extra! as CurrencyCatalogView
                : null,
          );
        },
      ),
      GoRoute(
        path: AppRoutes.pisoCampRecognition,
        builder: (context, state) => Consumer(
          builder: (context, ref, _) => RecognitionScannerScreen(
            modelSource: ref.watch(recognitionModelSourceProvider),
            // No approved inference runtime and no camera plugin in this
            // build: the screen says the reader is unavailable rather than
            // opening a camera that could never conclude anything, and it
            // never guesses at a denomination.
            engine: const UnavailableRecognitionEngine(),
            camera: const UnavailableCameraFrameSource(),
            confidenceThreshold: ref.watch(
              recognitionConfidenceThresholdProvider,
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/pisocamp/currency/:kind/:logicalId/ar',
        builder: (context, state) {
          final kind = CurrencyRouteKind.fromPathSegment(
            state.pathParameters['kind'] ?? '',
          );
          final logicalId = state.pathParameters['logicalId'] ?? '';
          if (kind == null || !isValidCurrencyLogicalId(logicalId)) {
            return const _SafeNotFoundScreen();
          }
          // The runtime is real now, but nothing below assumes it will work:
          // the probe still answers for phones without ARCore and for builds
          // assembled without the native half, and the screen still offers
          // CE-2's viewer when it does. What changed is only that a supported
          // phone now has somewhere to go.
          return Consumer(
            builder: (context, ref, _) => ArExperienceScreen(
              kind: kind,
              logicalId: logicalId,
              probe: const SceneViewArCapabilityProbe(),
              sessions: SceneViewArSessionFactory(
                loadModelBytes: (id) async {
                  final catalog = await ref.read(
                    currencyCatalogViewProvider.future,
                  );
                  final document = catalog.resolve(kind, id);
                  if (document == null) {
                    throw const CoinModelException(
                      CoinModelFailure.unavailable,
                    );
                  }
                  return catalog.readModelBytes(document);
                },
              ),
            ),
          );
        },
      ),
      GoRoute(
        path: '/pisocamp/currency/:kind/:logicalId/3d',
        builder: (context, state) {
          final kind = CurrencyRouteKind.fromPathSegment(
            state.pathParameters['kind'] ?? '',
          );
          final logicalId = state.pathParameters['logicalId'] ?? '';
          if (kind == null || !isValidCurrencyLogicalId(logicalId)) {
            return const _SafeNotFoundScreen();
          }
          return CoinViewerScreen(
            kind: kind,
            logicalId: logicalId,
            initialCatalog: state.extra is CurrencyCatalogView
                ? state.extra! as CurrencyCatalogView
                : null,
          );
        },
      ),
      GoRoute(
        path: '/pisocamp/currency/:kind/:logicalId',
        builder: (context, state) {
          final kind = CurrencyRouteKind.fromPathSegment(
            state.pathParameters['kind'] ?? '',
          );
          final logicalId = state.pathParameters['logicalId'] ?? '';
          if (kind == null || !isValidCurrencyLogicalId(logicalId)) {
            return const _SafeNotFoundScreen();
          }
          return CurrencyDetailScreen(
            kind: kind,
            logicalId: logicalId,
            initialCatalog: state.extra is CurrencyCatalogView
                ? state.extra! as CurrencyCatalogView
                : null,
          );
        },
      ),
    ],
    errorBuilder: (context, state) => const _SafeNotFoundScreen(),
  );

  ref.onDispose(() {
    refreshNotifier.dispose();
    router.dispose();
  });

  return router;
}

class _SafeNotFoundScreen extends StatelessWidget {
  const _SafeNotFoundScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: Text('Page not found.')));
  }
}
