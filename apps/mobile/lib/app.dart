import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:toastification/toastification.dart';
import 'package:mobile/core/navigation/app_router.dart';
import 'package:mobile/core/theme/theme_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/consent_provider.dart';
import 'package:mobile/features/pisocamp/presentation/providers/trivia_provider.dart';

/// Root widget for the application.
///
/// Wrapped with [ToastificationWrapper] so toasts can show globally.
/// Uses [GoRouter] for declarative routing with redirect logic based on
/// onboarding completion and authentication state.
class App extends ConsumerWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(consentSyncControllerProvider);
    // Kept alive here for the same reason as consent: an answer given offline,
    // or by a guest who has since registered, has to reach the account even if
    // the module itself is never reopened.
    ref.watch(triviaSyncControllerProvider);
    final mode = ref.watch(themeModeProvider);
    final light = ref.watch(lightThemeProvider);
    final dark = ref.watch(darkThemeProvider);
    final router = ref.watch(appRouterProvider);

    return ToastificationWrapper(
      child: MaterialApp.router(
        title: 'Piso CAMP',
        debugShowCheckedModeBanner: false,
        themeMode: mode,
        theme: light,
        darkTheme: dark,
        routerConfig: router,
      ),
    );
  }
}
