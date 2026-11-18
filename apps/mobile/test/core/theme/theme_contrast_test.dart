import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/theme/flex_theme_config.dart';

/// Contrast contract for the BSP palette.
///
/// The rendered accessibility audit (`accessibility_audit_test.dart`) measures
/// contrast from real pixels, but only for the text that happens to be on the
/// eight screens it covers. This asserts the palette itself, so a bad colour
/// pairing is caught at its source rather than wherever it first shows up.
///
/// It exists because of a specific mistake. `FlexKeyColors.keepPrimary` pins
/// `ColorScheme.primary` to the exact brand navy, which is right in light mode
/// and wrong in dark: against the near-black dark surface that navy measures
/// 1.56:1, so a filled button becomes an invisible slab. Its *label* still
/// passes, so a text-contrast check reports green while the control has
/// vanished. The `1.4.11` group below is what catches that class of bug.
void main() {
  double contrastRatio(Color a, Color b) {
    final double la = a.computeLuminance();
    final double lb = b.computeLuminance();
    final double lighter = math.max(la, lb);
    final double darker = math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  final Map<String, ColorScheme> schemes = <String, ColorScheme>{
    'light': FlexThemeConfig.light(AppColorScheme.bsp).colorScheme,
    'dark': FlexThemeConfig.dark(AppColorScheme.bsp).colorScheme,
  };

  for (final MapEntry<String, ColorScheme> entry in schemes.entries) {
    final String mode = entry.key;
    final ColorScheme scheme = entry.value;

    group('$mode scheme', () {
      // WCAG 1.4.3: text against the surface it sits on.
      final Map<String, List<Color>> textPairs = <String, List<Color>>{
        'onPrimary on primary': <Color>[scheme.onPrimary, scheme.primary],
        'onSecondary on secondary': <Color>[scheme.onSecondary, scheme.secondary],
        'onTertiary on tertiary': <Color>[scheme.onTertiary, scheme.tertiary],
        'onError on error': <Color>[scheme.onError, scheme.error],
        'onSurface on surface': <Color>[scheme.onSurface, scheme.surface],
        'onSurfaceVariant on surface': <Color>[scheme.onSurfaceVariant, scheme.surface],
        'onPrimaryContainer on primaryContainer': <Color>[
          scheme.onPrimaryContainer,
          scheme.primaryContainer,
        ],
        'onSecondaryContainer on secondaryContainer': <Color>[
          scheme.onSecondaryContainer,
          scheme.secondaryContainer,
        ],
        'onTertiaryContainer on tertiaryContainer': <Color>[
          scheme.onTertiaryContainer,
          scheme.tertiaryContainer,
        ],
        'onErrorContainer on errorContainer': <Color>[
          scheme.onErrorContainer,
          scheme.errorContainer,
        ],
      };

      textPairs.forEach((String name, List<Color> pair) {
        test('$name meets 4.5:1', () {
          expect(
            contrastRatio(pair[0], pair[1]),
            greaterThanOrEqualTo(4.5),
            reason: '$name fails WCAG 1.4.3 in $mode mode',
          );
        });
      });

      // WCAG 1.4.11: a control's own fill against the surface behind it. A
      // control whose label passes but whose body does not is still invisible.
      final Map<String, List<Color>> controlPairs = <String, List<Color>>{
        'primary against surface': <Color>[scheme.primary, scheme.surface],
        'secondary against surface': <Color>[scheme.secondary, scheme.surface],
        'error against surface': <Color>[scheme.error, scheme.surface],
      };

      controlPairs.forEach((String name, List<Color> pair) {
        test('$name meets 3:1', () {
          expect(
            contrastRatio(pair[0], pair[1]),
            greaterThanOrEqualTo(3.0),
            reason: '$name fails WCAG 1.4.11 in $mode mode',
          );
        });
      });
    });
  }

  test('light mode renders the exact seal navy', () {
    // `keepPrimary` in the light key colours is what guarantees this. If the
    // brand hex is ever allowed to drift into a tone-mapped approximation,
    // this is the assertion that says so.
    expect(
      FlexThemeConfig.light(AppColorScheme.bsp).colorScheme.primary,
      FlexThemeConfig.bspNavy,
    );
  });
}
