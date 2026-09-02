import { z } from "zod"

import { PisoCampSurveyTriggerConfigSchema } from "./survey-trigger.schema.js"

/** The complete allowlist of configuration safe for unauthenticated clients. */
export const PisoCampPublicConfigSchema = z
	.object({
		module_enabled: z.boolean(),
		account_prompt_enabled: z.boolean(),
		config_version: z.string(),
		// EV-3: when to ask, how often, and which survey wins. Public because a
		// guest's device needs it and it names nobody.
		survey_triggers: z.array(PisoCampSurveyTriggerConfigSchema).max(100),
	})
	.strict()

export type PisoCampPublicConfig = z.infer<typeof PisoCampPublicConfigSchema>

const SessionInactivityMinutesSchema = z.number().int().min(1).max(1440)

/** Complete administrator-visible Piso CAMP configuration. */
export const PisoCampAdminConfigSchema = z
	.object({
		session_inactivity_minutes: SessionInactivityMinutesSchema.default(30),
	})
	.strict()

/** Accepted payload for replacing administrator-managed configuration. */
export const UpdatePisoCampAdminConfigSchema = z
	.object({
		session_inactivity_minutes: SessionInactivityMinutesSchema,
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
