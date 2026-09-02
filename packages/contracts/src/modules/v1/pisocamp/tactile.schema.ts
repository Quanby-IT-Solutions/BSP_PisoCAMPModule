import { z } from "zod"

/**
 * CE-4 approved haptic patterns.
 *
 * A pattern is an identifier, not a waveform: the waveform lives in the client's
 * approved pattern catalog, because what a device can actually play differs by
 * platform. Keeping the vocabulary here is what lets the bundle and the client
 * be checked against each other.
 */
export const TACTILE_PATTERN_IDS = ["embossed", "bars", "intaglio"] as const
export const PisoCampTactilePatternIdSchema = z.enum(TACTILE_PATTERN_IDS)
export type PisoCampTactilePatternId = (typeof TACTILE_PATTERN_IDS)[number]

const PermilleSchema = z.number().int().min(0).max(1000)
const PositivePermilleSchema = z.number().int().min(1).max(1000)

/**
 * One touchable region of a banknote illustration, in permille of the image's
 * width and height so it survives any rendered size.
 */
export const PisoCampTactileRegionSchema = z
	.object({
		id: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
		label: z.string().trim().min(1).max(100),
		pattern: PisoCampTactilePatternIdSchema,
		x: PermilleSchema,
		y: PermilleSchema,
		width: PositivePermilleSchema,
		height: PositivePermilleSchema,
	})
	.strict()
	.superRefine((region, context) => {
		if (region.x + region.width > 1000) {
			context.addIssue({
				code: "custom",
				message: "A region cannot extend past the right edge of the image",
				path: ["width"],
			})
		}
		if (region.y + region.height > 1000) {
			context.addIssue({
				code: "custom",
				message: "A region cannot extend past the bottom edge of the image",
				path: ["height"],
			})
		}
	})

export const PisoCampTactileMapSchema = z
	.array(PisoCampTactileRegionSchema)
	.min(1)
	.max(12)
	.superRefine((regions, context) => {
		const seen = new Set<string>()
		for (const [index, region] of regions.entries()) {
			if (seen.has(region.id)) {
				context.addIssue({
					code: "custom",
					message: "Region identifiers must be unique within a map",
					path: [index, "id"],
				})
			}
			seen.add(region.id)
		}
	})

export type PisoCampTactileRegion = z.infer<typeof PisoCampTactileRegionSchema>
export type PisoCampTactileMap = z.infer<typeof PisoCampTactileMapSchema>

/**
 * CE-5 approved dynamic-feature effects.
 *
 * Like a haptic pattern, an effect is an identifier: the bundle names one and
 * the client's approved effect catalog decides what it looks like, because how
 * a device can render motion is a property of the device.
 */
export const TILT_EFFECT_IDS = ["colour-shift", "moving-band"] as const
export const PisoCampTiltEffectIdSchema = z.enum(TILT_EFFECT_IDS)
export type PisoCampTiltEffectId = (typeof TILT_EFFECT_IDS)[number]

/** The one region of a banknote illustration that responds to tilt. */
export const PisoCampTiltEffectSchema = z
	.object({
		id: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
		label: z.string().trim().min(1).max(100),
		effect: PisoCampTiltEffectIdSchema,
		x: PermilleSchema,
		y: PermilleSchema,
		width: PositivePermilleSchema,
		height: PositivePermilleSchema,
	})
	.strict()
	.superRefine((effect, context) => {
		if (effect.x + effect.width > 1000) {
			context.addIssue({
				code: "custom",
				message: "An effect cannot extend past the right edge of the image",
				path: ["width"],
			})
		}
		if (effect.y + effect.height > 1000) {
			context.addIssue({
				code: "custom",
				message: "An effect cannot extend past the bottom edge of the image",
				path: ["height"],
			})
		}
	})

export type PisoCampTiltEffect = z.infer<typeof PisoCampTiltEffectSchema>
