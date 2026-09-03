import { z } from "zod"

import { KEY_ACTION_EVENTS, KeyActionEventSchema } from "./adoption.schema.js"
import { PisoCampSurveyTriggerConfigSchema } from "./survey-trigger.schema.js"

/**
 * EV-4. How long before the exit advisory is shown again.
 *
 * Hours rather than days because "once a day" and "once per visit" are both
 * reasonable settings and only one of them is a whole number of days.
 */
const ExitAdvisoryIntervalHoursSchema = z.number().int().min(1).max(8760)

const SessionInactivityMinutesSchema = z.number().int().min(1).max(1440)

/**
 * AN-4. How long somebody has to be quiet before they count as churned.
 *
 * Days rather than minutes: churn is a question about weeks away from the
 * module, and the session gap that ends a visit is a different setting with a
 * different unit for a reason.
 */
const ChurnInactivityDaysSchema = z.number().int().min(1).max(365)

/** GM-001. How long before the same trivia question may be asked again. */
const TriviaRepeatDaysSchema = z.number().int().min(1).max(365)

/**
 * AN-010 / AN-3. Which events count as "the person got value from the module".
 *
 * Configurable because BSP decides what a key action is; the report only
 * measures how long it took to happen. At least one, or the time-to-first-key-
 * action figure would have nothing to wait for.
 */
const KeyActionEventsSchema = z.array(KeyActionEventSchema).min(1).max(20)

/**
 * AN-10's age groups, as boundaries rather than labels.
 *
 * A bucket ends where the next begins and the last one is open, so every age
 * lands in exactly one group. Overlapping buckets would put one person in two
 * of them and make the percentages add up to more than everybody.
 */
const AgeGroupBucketSchema = z
	.object({ minAge: z.number().int().min(0).max(120), maxAge: z.number().int().min(1).max(120).nullable() })
	.strict()
	.refine(bucket => bucket.maxAge === null || bucket.maxAge >= bucket.minAge, {
		message: "A bucket may not end before it starts",
	})

const AgeGroupBucketsSchema = z
	.array(AgeGroupBucketSchema)
	.min(1)
	.max(12)
	.refine(
		buckets =>
			buckets.every((bucket, index) => {
				if (index === 0) return true
				const previous = buckets[index - 1]!
				return previous.maxAge !== null && bucket.minAge > previous.maxAge
			}),
		{ message: "Age groups must be in order and must not overlap" }
	)
	.refine(buckets => buckets.at(-1)?.maxAge === null, {
		message: "The last age group must be open-ended, so every age falls in one",
	})

/**
 * AN-10. The smallest group whose figures may be shown.
 *
 * Below it a demographic cut is suppressed: a percentage over three people is
 * a description of those three people.
 */
const SuppressionMinimumSchema = z.number().int().min(2).max(1000)

/** GM-007. Whether the leaderboard is offered at all. */
const LeaderboardEnabledSchema = z.boolean()

/**
 * How sure the on-device model must be before it names a denomination.
 *
 * A recognition the model is not confident about is a wrong answer waiting to
 * be shown as a right one.
 */
const RecognitionConfidenceSchema = z.number().min(0.5).max(1)

/**
 * UM-005. Which privacy notice version is the current one.
 *
 * Owned by F4's consent flow, which reads this same key and refuses to serve
 * consent when it names a notice that is not stored. SA-3 only provides the
 * screen to change it — and refuses a version that does not exist, so the
 * change cannot take consent down.
 */
const ActiveNoticeVersionSchema = z.string().min(1).max(64).nullable()

/** The complete allowlist of configuration safe for unauthenticated clients. */
export const PisoCampPublicConfigSchema = z
	.object({
		module_enabled: z.boolean(),
		account_prompt_enabled: z.boolean(),
		config_version: z.string(),
		// EV-3: when to ask, how often, and which survey wins. Public because a
		// guest's device needs it and it names nobody.
		survey_triggers: z.array(PisoCampSurveyTriggerConfigSchema).max(100),
		// EV-4: how often the exit advisory is shown. Public because the device
		// decides when to show it, offline included.
		exit_advisory_interval_hours: ExitAdvisoryIntervalHoursSchema,
		// SA-3: settings the device itself acts on. GM-007 decides whether the
		// leaderboard appears at all, GM-001 how long before a question repeats,
		// the threshold how sure the on-device model must be, and UM-005 which
		// notice a device should be showing.
		leaderboard_enabled: LeaderboardEnabledSchema,
		trivia_repeat_days: TriviaRepeatDaysSchema,
		recognition_confidence_threshold: RecognitionConfidenceSchema,
		active_privacy_notice_version: ActiveNoticeVersionSchema,
	})
	.strict()

export type PisoCampPublicConfig = z.infer<typeof PisoCampPublicConfigSchema>

/** Complete administrator-visible Piso CAMP configuration. */
export const PisoCampAdminConfigSchema = z
	.object({
		session_inactivity_minutes: SessionInactivityMinutesSchema.default(30),
		exit_advisory_interval_hours: ExitAdvisoryIntervalHoursSchema.default(24),
		churn_inactivity_days: ChurnInactivityDaysSchema.default(30),
		trivia_repeat_days: TriviaRepeatDaysSchema.default(30),
		leaderboard_enabled: LeaderboardEnabledSchema.default(false),
		key_action_events: KeyActionEventsSchema.default([...KEY_ACTION_EVENTS]),
		age_group_buckets: AgeGroupBucketsSchema.default([
			{ minAge: 0, maxAge: 17 },
			{ minAge: 18, maxAge: 24 },
			{ minAge: 25, maxAge: 34 },
			{ minAge: 35, maxAge: 44 },
			{ minAge: 45, maxAge: 59 },
			{ minAge: 60, maxAge: null },
		]),
		suppression_minimum: SuppressionMinimumSchema.default(10),
		recognition_confidence_threshold: RecognitionConfidenceSchema.default(0.8),
		active_privacy_notice_version: ActiveNoticeVersionSchema.default(null),
	})
	.strict()

/** Accepted payload for replacing administrator-managed configuration. */
export const UpdatePisoCampAdminConfigSchema = z
	.object({
		session_inactivity_minutes: SessionInactivityMinutesSchema,
		exit_advisory_interval_hours: ExitAdvisoryIntervalHoursSchema,
		churn_inactivity_days: ChurnInactivityDaysSchema,
		trivia_repeat_days: TriviaRepeatDaysSchema,
		leaderboard_enabled: LeaderboardEnabledSchema,
		key_action_events: KeyActionEventsSchema,
		age_group_buckets: AgeGroupBucketsSchema,
		suppression_minimum: SuppressionMinimumSchema,
		recognition_confidence_threshold: RecognitionConfidenceSchema,
		active_privacy_notice_version: ActiveNoticeVersionSchema,
	})
	.strict()

export type PisoCampAdminConfig = z.infer<typeof PisoCampAdminConfigSchema>
export type UpdatePisoCampAdminConfig = z.infer<typeof UpdatePisoCampAdminConfigSchema>

export const CONSENT_PURPOSES = ["registration", "survey", "demographic_analytics"] as const
export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES)

export const CONSENT_DECISIONS = ["granted", "declined"] as const
export const ConsentDecisionSchema = z.enum(CONSENT_DECISIONS)

export const CONSENT_STATES = [
	"none",
	"granted",
	"declined",
	"withdrawn",
	"requires_reconsent",
] as const
export const ConsentStateSchema = z.enum(CONSENT_STATES)

/** F1 creates 16 random bytes and stores their 22-character unpadded Base64URL form. */
export const DevicePseudoIdSchema = z
	.string()
	.length(22)
	.regex(/^[A-Za-z0-9_-]{22}$/)

export const PisoCampPrivacyNoticeSchema = z
	.object({
		id: z.uuid(),
		version: z.string().min(1).max(64),
		title: z.string().min(1).max(200),
		body: z.string().min(1),
		sourceUrl: z.url(),
		contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
		effectiveAt: z.iso.datetime({ offset: true }),
	})
	.strict()

export const GetPisoCampConsentInputSchema = z.object({ purpose: ConsentPurposeSchema }).strict()

export const PisoCampConsentStatusSchema = z
	.object({
		purpose: ConsentPurposeSchema,
		state: ConsentStateSchema,
		notice: PisoCampPrivacyNoticeSchema,
	})
	.strict()

export const RecordPisoCampConsentInputSchema = z
	.object({
		id: z.uuid(),
		purpose: ConsentPurposeSchema,
		noticeId: z.uuid(),
		noticeVersion: z.string().min(1).max(64),
		decision: ConsentDecisionSchema,
		respondedAt: z.iso.datetime({ offset: true }),
	})
	.strict()

export const RecordedPisoCampConsentSchema = RecordPisoCampConsentInputSchema.extend({
	recordedAt: z.iso.datetime({ offset: true }),
	state: ConsentStateSchema,
}).strict()

export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>
export type ConsentDecision = z.infer<typeof ConsentDecisionSchema>
export type ConsentState = z.infer<typeof ConsentStateSchema>
export type PisoCampPrivacyNotice = z.infer<typeof PisoCampPrivacyNoticeSchema>
export type PisoCampConsentStatus = z.infer<typeof PisoCampConsentStatusSchema>
export type RecordPisoCampConsentInput = z.infer<typeof RecordPisoCampConsentInputSchema>
export type RecordedPisoCampConsent = z.infer<typeof RecordedPisoCampConsentSchema>

export const PisoCampGenderSchema = z.enum(["female", "male", "prefer_not_to_say"])
export const PisoCampLocationCodeSchema = z.string().regex(/^\d{10}$/)
export const UpsertPisoCampProfileInputSchema = z
	.object({
		id: z.uuid(),
		gender: PisoCampGenderSchema,
		age: z.number().int().min(1).max(120),
		regionCode: PisoCampLocationCodeSchema,
		cityCode: PisoCampLocationCodeSchema,
	})
	.strict()

export const PisoCampProfileDataSchema = UpsertPisoCampProfileInputSchema.omit({ id: true })
	.extend({
		registrationConsentRecordId: z.uuid(),
	})
	.strict()

const PisoCampMissingFieldSchema = z.enum(["gender", "age", "regionCode", "cityCode"])
const PisoCampProfileIdentityShape = {
	name: z.string().min(1),
	email: z.email(),
}

export const PisoCampProfileOutputSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("missing"),
			missingFields: z.array(PisoCampMissingFieldSchema).min(1),
			...PisoCampProfileIdentityShape,
			profile: z.null(),
		})
		.strict(),
	z
		.object({
			status: z.literal("complete"),
			missingFields: z.array(PisoCampMissingFieldSchema).length(0),
			...PisoCampProfileIdentityShape,
			profile: PisoCampProfileDataSchema,
		})
		.strict(),
])

/** Compatibility name retained for existing contracts, DTOs, and consumers. */
export const PisoCampProfileSchema = PisoCampProfileOutputSchema

export const PisoCampCitySchema = z
	.object({ code: PisoCampLocationCodeSchema, name: z.string().min(1) })
	.strict()
export const PisoCampRegionSchema = z
	.object({
		code: PisoCampLocationCodeSchema,
		name: z.string().min(1),
		cities: z.array(PisoCampCitySchema),
	})
	.strict()
export const PisoCampLocationCatalogSchema = z
	.object({
		version: z.literal("PSGC-2Q-2026"),
		sourceUrl: z.url(),
		catalogSha256: z.string().regex(/^[a-f0-9]{64}$/),
		regions: z.array(PisoCampRegionSchema),
	})
	.strict()
