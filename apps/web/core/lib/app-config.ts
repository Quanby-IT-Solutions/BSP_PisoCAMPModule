/**
 * Single source of truth for app identity values.
 *
 * Consumed by the web manifest (`app/manifest.ts`), the root layout
 * metadata/viewport (`app/layout.tsx`), and — indirectly via text extraction —
 * the Node ESM PWA icon generator (`scripts/generate-pwa-icons.mjs`), which
 * cannot import TypeScript directly without a build step.
 */

/**
 * Full application name shown in the manifest and install prompts.
 */
export const APP_NAME = "Piso CAMP"

/**
 * Short application name used where space is constrained (home screen label).
 */
export const APP_SHORT_NAME = "Piso CAMP"

/**
 * Human-readable description of the app for the manifest and metadata.
 */
export const APP_DESCRIPTION =
	"Administration console for Piso CAMP, the Bangko Sentral ng Pilipinas currency education module"

/**
 * Fixed brand theme color for the manifest and generated icon backgrounds.
 *
 * BSP navy, measured from the seal rather than picked by eye: it is the single
 * most common pixel value in the artwork, and white on it is 11.9:1. The
 * Flutter app seeds its theme from the same value, so an install prompt and a
 * launcher icon agree across the two clients.
 */
export const APP_THEME_COLOR = "#1B3665"

/**
 * Manifest background color shown behind the splash screen.
 */
export const APP_BACKGROUND_COLOR = "#ffffff"

/**
 * `<meta name="theme-color">` value for light color scheme.
 */
export const VIEWPORT_THEME_COLOR_LIGHT = "#ffffff"

/**
 * `<meta name="theme-color">` value for dark color scheme.
 */
export const VIEWPORT_THEME_COLOR_DARK = "#0a0a0a"
