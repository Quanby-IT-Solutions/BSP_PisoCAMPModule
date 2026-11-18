import 'package:flex_color_scheme/flex_color_scheme.dart';
import 'package:flutter/material.dart';
import 'package:mobile/core/theme/app_styles.dart';

/// Available color scheme choices for the app theme.
///
/// One value, deliberately. This used to offer six built-in FlexColorScheme
/// palettes (blue, green, purple…), but nothing ever selected one:
/// `ThemeController.setColorScheme` is not called anywhere in the app and no
/// screen exposes a palette picker — the Settings tab offers System/Light/Dark
/// only. The enum survives so the controller and storage keep their shape; a
/// device still holding a persisted `"blue"` resolves through
/// `ThemeStorageService`'s `orElse` back to [FlexThemeConfig.defaultColorScheme]
/// rather than failing.
enum AppColorScheme {
  /// Bangko Sentral ng Pilipinas — navy and gold, taken from the BSP seal.
  bsp,
}

/// Builds the app's [ThemeData] from the BSP brand colours via
/// `flex_color_scheme`.
class FlexThemeConfig {
  FlexThemeConfig._();

  static const ThemeMode defaultThemeMode = ThemeMode.system;
  static const AppColorScheme defaultColorScheme = AppColorScheme.bsp;

  /// The seal's dominant navy field — the single most common colour in the
  /// logo. White on it measures 11.4:1, comfortably past WCAG AAA.
  static const Color bspNavy = Color(0xFF1B3665);

  /// The gold of the rim and the eagle.
  static const Color bspGold = Color(0xFFC0A32F);

  /// The lighter navy of the seal's lower band.
  static const Color bspSlate = Color(0xFF3B4A75);

  /// The brand colours as seed keys.
  ///
  /// These are seeds, not finished scheme colours. Gold especially: it is a
  /// light colour, and written straight into `ColorScheme.secondary` it gives
  /// ~2.5:1 against white and ~2.4:1 against a light surface — failures of
  /// WCAG 1.4.3 and 1.4.11 respectively. Seeding lets Material re-tone it
  /// into a role that carries a safe on-colour, which is measured and
  /// asserted in `test/core/theme/theme_contrast_test.dart`.
  static const FlexSchemeColor _brand = FlexSchemeColor(
    primary: bspNavy,
    secondary: bspGold,
    tertiary: bspSlate,
  );

  /// `useSecondary`/`useTertiary` are load-bearing: FlexColorScheme only
  /// forwards the secondary and tertiary keys to the seed generator when they
  /// are true, and they default to false. Omit them and the gold and slate
  /// are silently discarded with no error.
  ///
  /// `keepPrimary: true` pins `primary` to the exact seal navy rather than a
  /// tone-mapped approximation. Light mode can afford it — white on that navy
  /// is 11.9:1, and the navy against the light surface is 11.4:1.
  static const FlexKeyColors _lightKeys = FlexKeyColors(
    useSecondary: true,
    useTertiary: true,
    keepPrimary: true,
  );

  /// Dark mode deliberately does **not** pin the primary.
  ///
  /// The seal navy is a dark colour. Pinned against the tone-6 dark surface it
  /// measures 1.56:1 — a filled button would be a near-invisible slab, even
  /// though its white label reads fine. Contrast guidelines catch the label
  /// and miss the button, so this is a bug that tests do not report and eyes
  /// do. Dark mode takes the palette's lighter navy instead.
  static const FlexKeyColors _darkKeys = FlexKeyColors(
    useSecondary: true,
    useTertiary: true,
  );

  /// Component geometry, applied once so every screen inherits it.
  ///
  /// This is what makes the direction uniform without touching twenty screens:
  /// radii, elevation and control shapes are set on the theme rather than
  /// per-widget, so a screen that simply uses `Card` or `FilledButton` is
  /// already on-system.
  ///
  /// The radii follow the ladder in [AppRadii] — cards at 16, controls at 14.
  /// Elevation stays at zero throughout: surfaces separate by fill and
  /// hairline, and the only lift in the design comes from the explicit
  /// [AppShadows] used by the grouped list and action tiles.
  static const FlexSubThemesData _components = FlexSubThemesData(
    defaultRadius: AppRadii.tile,
    cardRadius: AppRadii.card,
    dialogRadius: AppRadii.hero,
    bottomSheetRadius: AppRadii.hero,
    inputDecoratorRadius: AppRadii.tile,
    inputDecoratorIsFilled: true,
    inputDecoratorBorderType: FlexInputBorderType.outline,
    inputDecoratorUnfocusedHasBorder: false,
    cardElevation: 0,
    elevatedButtonElevation: 0,
    // Flat surfaces: the AppBar reads as part of the page, and the divider
    // under it does the separating.
    appBarScrolledUnderElevation: 0.5,
    // The bottom bar is a translucent plane over scrolling content rather
    // than an opaque bar, which is what keeps the page feeling continuous.
    navigationBarElevation: 0,
    navigationBarOpacity: 0.96,
    navigationBarIndicatorSchemeColor: SchemeColor.primaryContainer,
    // Tap targets stay at Material's accessible minimum — the reference's
    // tighter density is expressed through spacing and type, never by
    // shrinking a touch target below 48dp.
    alignedDropdown: true,
  );

  /// Builds a light [ThemeData] for the given colour scheme.
  static ThemeData light(AppColorScheme scheme) {
    return FlexThemeData.light(
      colors: _brand,
      keyColors: _lightKeys,
      subThemesData: _components,
      useMaterial3: true,
      appBarStyle: FlexAppBarStyle.surface,
    );
  }

  /// Builds a dark [ThemeData] for the given colour scheme.
  static ThemeData dark(AppColorScheme scheme) {
    return FlexThemeData.dark(
      colors: _brand,
      keyColors: _darkKeys,
      subThemesData: _components,
      useMaterial3: true,
      appBarStyle: FlexAppBarStyle.surface,
    );
  }
}
