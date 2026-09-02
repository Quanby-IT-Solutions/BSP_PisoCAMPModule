import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

/**
 * The features AN-013 asks to be reported separately.
 *
 * The whole list, including the ones nothing emits yet: a feature missing from
 * a report reads as a feature nobody used, and "not built" and "not used" are
 * different answers. Each is reported with a zero until its ticket lands.
 */
export const ADOPTION_FEATURES = [
	"currency_education",
	"banknotes",
	"coins",
	"3d_coin",
	"haptic",
	"tilt",
	"zoom_pan",
	"trivia",
	"leaderboard",
	"ar",
	"recognition",
	"survey",
	"advisory",
	"external_link",
	"internal_link",
] as const
export const AdoptionFeatureSchema = z.enum(ADOPTION_FEATURES)

/**
 * The events that count as a key action, as configured.
 *
 * BSP decides what "getting value from the module" means; the report only
 * measures how long it took to happen.
 */
export const KEY_ACTION_EVENTS = [
	"content_view",
	"feature_use",
	"trivia_prompt_answered",
	"survey_submitted",
] as const
export const KeyActionEventSchema = z.enum(KEY_ACTION_EVENTS)

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

export const FeatureUsageSchema = z
	.object({
		feature: AdoptionFeatureSchema,
		/** How many times it was used. */
		uses: NonNegativeInt,
		/** How many distinct people used it. */
		users: NonNegativeInt,
	})
	.strict()

export const AdoptionSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** The key actions this report counted, as configured. */
		keyActionEvents: z.array(KeyActionEventSchema).min(1),
		promptedUsers: NonNegativeInt,
		registeredUsers: NonNegativeInt,
		/** Registered ÷ prompted × 100. Zero when nobody was prompted. */
		accountCreationRatePercent: Ratio,
		/** Seconds from a person's first module entry to their first key action. */
		timeToFirstKeyActionMedianSeconds: z.number().nonnegative().nullable(),
		timeToFirstKeyActionP95Seconds: z.number().nonnegative().nullable(),
		/** Entered the module, and did a key action within 24 hours of doing so. */
		firstDayActivatedUsers: NonNegativeInt,
		enteredUsers: NonNegativeInt,
		firstDayActivationRatePercent: Ratio,
		features: z.array(FeatureUsageSchema).length(ADOPTION_FEATURES.length),
	})
	.strict()

export const AdoptionRangeInputSchema = EngagementRangeInputSchema

export type AdoptionFeature = z.infer<typeof AdoptionFeatureSchema>
export type KeyActionEvent = z.infer<typeof KeyActionEventSchema>
export type FeatureUsage = z.infer<typeof FeatureUsageSchema>
export type AdoptionSummary = z.infer<typeof AdoptionSummarySchema>
