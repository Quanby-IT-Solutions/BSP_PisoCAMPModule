import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:introduction_screen/introduction_screen.dart';
import 'package:mobile/features/onboarding/presentation/providers/onboarding_provider.dart';
import 'package:mobile/shared/widgets/bsp_logo.dart';

class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return IntroductionScreen(
      globalBackgroundColor: theme.scaffoldBackgroundColor,
      pages: [
        _buildPage(
          theme: theme,
          icon: CupertinoIcons.rocket_fill,
          gradientColors: [colorScheme.primary, colorScheme.tertiary],
          artwork: const BspLogo(
            size: 180,
            semanticLabel: 'Bangko Sentral ng Pilipinas',
          ),
          title: 'Welcome to Piso CAMP',
          body:
              'Get to know Philippine banknotes and coins —\n'
              'their designs, features and history.',
        ),
        _buildPage(
          theme: theme,
          icon: CupertinoIcons.checkmark_seal_fill,
          gradientColors: [colorScheme.tertiary, colorScheme.secondary],
          title: 'Explore Notes and Coins',
          body:
              'Browse each denomination in detail, and keep\n'
              'reading even when you are offline.',
        ),
        _buildPage(
          theme: theme,
          icon: CupertinoIcons.person_2_fill,
          gradientColors: [colorScheme.secondary, colorScheme.primary],
          title: 'An Account Is Optional',
          body:
              'Continue as a guest, or create an account\n'
              'to keep your progress across devices.',
        ),
      ],
      showSkipButton: true,
      skip: Text(
        'Skip',
        style: TextStyle(
          color: colorScheme.onSurface.withOpacity(0.6),
          fontWeight: FontWeight.w500,
          letterSpacing: 0.5,
        ),
      ),
      next: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colorScheme.primaryContainer,
          shape: BoxShape.circle,
        ),
        child: Icon(
          CupertinoIcons.arrow_right,
          color: colorScheme.onPrimaryContainer,
          size: 20,
        ),
      ),
      done: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: colorScheme.primary,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          'Start',
          // Not a hardcoded white: this label sits on `colorScheme.primary`,
          // so its contrast is only guaranteed if it tracks that colour's
          // on-colour. A literal white survives any palette change and
          // silently fails against a light primary.
          style: TextStyle(
            color: colorScheme.onPrimary,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
      ),
      onDone: () {
        ref.read(onboardingStateProvider.notifier).completeOnboarding();
      },
      onSkip: () {
        ref.read(onboardingStateProvider.notifier).completeOnboarding();
      },
      dotsDecorator: DotsDecorator(
        size: const Size.square(8.0),
        activeSize: const Size(24.0, 8.0),
        activeColor: colorScheme.primary,
        color: colorScheme.outlineVariant.withOpacity(0.5),
        activeShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
        ),
        spacing: const EdgeInsets.symmetric(horizontal: 4),
      ),
      isProgressTap: false,
      curve: Curves.easeOutCubic,
      scrollPhysics: const BouncingScrollPhysics(),
      controlsPadding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
    );
  }

  PageViewModel _buildPage({
    required ThemeData theme,
    required IconData icon,
    required List<Color> gradientColors,
    required String title,
    required String body,
    // The BSP seal is already a navy medallion inside a gold rim. Nesting it
    // in the primary-coloured circle the icon pages use buries it in a second
    // ring of almost the same colour, so a page supplying [artwork] replaces
    // the whole three-circle motif rather than sitting inside it.
    Widget? artwork,
  }) {
    return PageViewModel(
      titleWidget: Padding(
        padding: const EdgeInsets.only(top: 48), // Generous spacing
        child: Text(
          title,
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineLarge!.copyWith(
            fontWeight: FontWeight.w600, // Semibold Apple style
            color: theme.colorScheme.onSurface.withOpacity(0.9),
            letterSpacing: -0.5,
            height: 1.1,
          ),
        ),
      ),
      bodyWidget: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
        child: Text(
          body,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyLarge!.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.6),
            height: 1.47,
          ),
        ),
      ),
      image: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Flexible, not a fixed box: this is decorative top spacing, and
            // on a short viewport 64 + the 180 circle exceeds the slot the
            // carousel gives this widget, overflowing by a few pixels.
            // Letting the spacer absorb the shortfall keeps the art intact.
            const Flexible(child: SizedBox(height: 64)),
            if (artwork != null)
              SizedBox(width: 180, height: 180, child: Center(child: artwork))
            else
              Container(
                width: 180,
                height: 180,
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHigh.withOpacity(0.5),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Container(
                    width: 120,
                    height: 120,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer,
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          icon,
                          size: 32,
                          color: theme.colorScheme.onPrimary,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
      decoration: PageDecoration(
        imagePadding: EdgeInsets.zero,
        bodyPadding: const EdgeInsets.symmetric(horizontal: 8),
        titlePadding: const EdgeInsets.only(bottom: 0),
        bodyAlignment: Alignment.center,
        imageAlignment: Alignment.center,
      ),
    );
  }
}
