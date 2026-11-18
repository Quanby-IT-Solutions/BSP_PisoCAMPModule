import 'package:flutter/material.dart';

/// Layout rhythm.
///
/// The 24/16 pair carries the visual direction: content sits on a 24pt gutter
/// while grouped list cards inset to 16pt, so a card reads as a wider plane
/// sitting under the text rather than as another column of copy.
class AppSpacing {
  AppSpacing._();
  static const double s2 = 2.0;
  static const double s4 = 4.0;
  static const double s6 = 6.0;
  static const double s8 = 8.0;
  static const double s12 = 12.0;
  static const double s16 = 16.0;
  static const double s20 = 20.0;
  static const double s24 = 24.0;
  static const double s32 = 32.0;
  static const double s48 = 48.0;

  /// Horizontal gutter for page content.
  static const double pageGutter = s24;

  /// Horizontal inset for grouped list cards — deliberately tighter than
  /// [pageGutter] so the card overhangs the text column on both sides.
  static const double cardGutter = s16;
}

/// Corner geometry.
///
/// A deliberate ladder rather than one radius everywhere: the larger the
/// surface, the larger the corner. A hero panel at 18, a grouped list at 16,
/// a tappable tile at 14, a small leading badge at 10. Uniform radii flatten
/// that hierarchy and make everything read as the same weight.
class AppRadii {
  AppRadii._();
  static const double badge = 10.0;
  static const double tile = 14.0;
  static const double card = 16.0;
  static const double hero = 18.0;
  static const double circle = 999.0;

  // Retained names, remapped onto the ladder above.
  static const double small = badge;
  static const double medium = tile;
  static const double pill = 24.0;

  static final BorderRadius badgeRadius = BorderRadius.circular(badge);
  static final BorderRadius tileRadius = BorderRadius.circular(tile);
  static final BorderRadius cardRadius = BorderRadius.circular(card);
  static final BorderRadius heroRadius = BorderRadius.circular(hero);
  static final BorderRadius smallRadius = BorderRadius.circular(small);
  static final BorderRadius mediumRadius = BorderRadius.circular(medium);
  static final BorderRadius pillRadius = BorderRadius.circular(pill);
}

/// Elevation.
///
/// Near-flat by design. Surfaces separate through their own fill and a hairline
/// divider, not through drop shadows; the shadow only stops a white card from
/// disappearing into a near-white page. Anything heavier reads as Material's
/// default elevation rather than this direction.
class AppShadows {
  AppShadows._();

  /// For raised tappable surfaces — action tiles, floating circular buttons.
  static List<BoxShadow> tile(ColorScheme colorScheme) => <BoxShadow>[
    BoxShadow(
      offset: const Offset(0, 2),
      blurRadius: 6,
      color: colorScheme.shadow.withValues(alpha: 0.04),
    ),
  ];

  /// For grouped list cards. Fainter than [tile]: the card is large, so the
  /// same shadow would read as a much heavier lift.
  static List<BoxShadow> card(ColorScheme colorScheme) => <BoxShadow>[
    BoxShadow(
      offset: const Offset(0, 2),
      blurRadius: 6,
      color: colorScheme.shadow.withValues(alpha: 0.03),
    ),
  ];

  static BoxShadow subtle(ColorScheme colorScheme) {
    return BoxShadow(
      offset: const Offset(0, 2),
      blurRadius: 20,
      color: colorScheme.shadow.withValues(alpha: 0.06),
    );
  }
}

/// Surfaces that must read as sitting *above* the page.
///
/// The direction puts white cards on a near-white canvas, which works because
/// a light theme's lowest surface is lighter than its background. Dark mode
/// inverts that relationship — the lowest surface is the darkest — so reusing
/// the same token there makes cards and tiles vanish into the page. The lift
/// has to follow the brightness, not the token name.
class AppSurfaces {
  AppSurfaces._();

  static Color raised(ColorScheme colorScheme) =>
      colorScheme.brightness == Brightness.light
      ? colorScheme.surfaceContainerLowest
      : colorScheme.surfaceContainerHigh;
}

/// Hairline rules.
///
/// Dividers sit between rows inside a card and never after the last one — a
/// trailing rule reads as a truncated list. Kept sub-pixel so it reads as a
/// seam rather than a line.
class AppDividers {
  AppDividers._();
  static const double hairline = 0.5;

  static BorderSide side(ColorScheme colorScheme) =>
      BorderSide(color: colorScheme.outlineVariant, width: hairline);
}

class AppMotion {
  AppMotion._();
  static const Duration durationFast = Duration(milliseconds: 200);
  static const Duration durationStandard = Duration(milliseconds: 300);
  static const Curve enterCurve = Curves.easeOutCubic;
  static const Curve transitionCurve = Curves.easeInOutQuart;
}
