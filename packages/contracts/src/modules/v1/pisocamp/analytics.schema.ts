import { z } from "zod"

import { SURVEY_PURPOSES } from "./content.schema.js"

import { DevicePseudoIdSchema } from "./pisocamp.schema.js"

const EVENT_MAX_BYTES = 8 * 1024
const BATCH_MAX_BYTES = 512 * 1024
const textEncoder = new TextEncoder()
const forbiddenKeySegments = [
	"email",
	"name",
	"image",
	"photo",
	"frame",
	"token",
	"cookie",
	"authorization",
] as const

export const ANALYTICS_EVENT_NAMES = [
	"module_entry",
	"account_prompt_shown",
	"account_prompt_guest",
	"content_view",
	"feature_use",
	"link_open",
	"trivia_prompt_shown",
	"trivia_prompt_answered",
	"trivia_prompt_skipped",
	"survey_prompt_shown",
	"survey_declined",
	"survey_submitted",
	"advisory_shown",
	"profile_created",
	"module_load",
	"network_failure",
] as const

/**
 * The ways a request can fail on a device, as AN-024 asks them to be counted.
 *
 * "No connectivity" and "timeout" are different problems with different fixes,
 * and a single failure count would hide which one people are hitting.
 */
export const ANALYTICS_NETWORK_FAILURE_TYPES = [
	"timeout",
	"no_connectivity",
	"sync_failed",
	"download_failed",
	"report_failed",
	"upload_failed",
] as const

/**
 * Screens that may report a `feature_use`. A feature is bound to the one screen
 * that hosts it so a mislabelled event is rejected rather than silently counted
 * against the wrong surface.
 */
export const ANALYTICS_FEATURE_USE_SCREENS = {
	"3d_coin": "coin_3d_viewer",
	haptic: "tactile_viewer",
	tilt: "tilt_viewer",
} as const

export type AnalyticsFeatureUseFeature = keyof typeof ANALYTICS_FEATURE_USE_SCREENS

const FEATURE_USE_FEATURES = Object.keys(ANALYTICS_FEATURE_USE_SCREENS) as [
	AnalyticsFeatureUseFeature,
	...AnalyticsFeatureUseFeature[],
]

export const UuidV4Schema = z
	.string()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

const AnalyticsCommonSchema = z.object({
	schemaVersion: z.literal(1),
	eventId: UuidV4Schema,
	occurredAt: z.iso.datetime({ offset: true }),
	subjectPseudoId: DevicePseudoIdSchema,
	sessionId: UuidV4Schema,
	accountType: z.enum(["guest", "registered"]),
	appVersion: z.string().trim().min(1).max(64),
	osName: z.enum(["android", "ios", "other"]),
	osVersion: z.string().trim().min(1).max(96),
	deviceCategory: z.enum(["phone", "tablet", "other"]),
	networkState: z.enum(["online", "offline", "unknown"]),
})

const AnalyticsEventCatalogSchema = z.discriminatedUnion("eventName", [
	AnalyticsCommonSchema.extend({
		eventName: z.literal("module_entry"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("module"),
		status: z.literal("completed"),
		properties: z.object({ entryPoint: z.enum(["navigation", "deep_link", "other"]) }).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("account_prompt_shown"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("account_prompt"),
		status: z.literal("completed"),
		properties: z.object({}).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("account_prompt_guest"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("account_prompt"),
		status: z.literal("completed"),
		properties: z.object({}).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("content_view"),
		screen: z.literal("currency_detail"),
		feature: z.literal("currency_education"),
		status: z.literal("completed"),
		properties: z.object({ logicalId: z.string().trim().min(1).max(128) }).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("trivia_prompt_shown"),
		screen: z.literal("trivia_prompt"),
		feature: z.literal("trivia"),
		status: z.literal("completed"),
		properties: z
			.object({
				logicalId: z.string().trim().min(1).max(128),
				category: z.string().trim().min(1).max(64),
				difficulty: z.enum(["easy", "medium", "hard"]),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("trivia_prompt_answered"),
		screen: z.literal("trivia_prompt"),
		feature: z.literal("trivia"),
		status: z.literal("completed"),
		properties: z
			.object({
				logicalId: z.string().trim().min(1).max(128),
				category: z.string().trim().min(1).max(64),
				difficulty: z.enum(["easy", "medium", "hard"]),
				// Whether the answer was right, never which answer was chosen: the
				// chosen label is content, and analytics carries none.
				correct: z.boolean(),
				openedTopic: z.boolean(),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("trivia_prompt_skipped"),
		screen: z.literal("trivia_prompt"),
		feature: z.literal("trivia"),
		status: z.literal("completed"),
		properties: z
			.object({
				logicalId: z.string().trim().min(1).max(128),
				category: z.string().trim().min(1).max(64),
				difficulty: z.enum(["easy", "medium", "hard"]),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("survey_prompt_shown"),
		screen: z.literal("survey_prompt"),
		feature: z.literal("survey"),
		status: z.literal("completed"),
		properties: z
			.object({
				logicalId: z.string().trim().min(1).max(128),
				purpose: z.enum(SURVEY_PURPOSES),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("survey_declined"),
		screen: z.literal("survey_prompt"),
		feature: z.literal("survey"),
		status: z.literal("completed"),
		properties: z
			.object({
				logicalId: z.string().trim().min(1).max(128),
				purpose: z.enum(SURVEY_PURPOSES),
				// Declining the prompt and declining the notice are different
				// refusals, and only the second one means a notice was read.
				stage: z.enum(["prompt", "notice"]),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("survey_submitted"),
		screen: z.literal("survey_prompt"),
		feature: z.literal("survey"),
		status: z.literal("completed"),
		properties: z
			.object({
				logicalId: z.string().trim().min(1).max(128),
				purpose: z.enum(SURVEY_PURPOSES),
				// How many questions were answered, never what any answer was:
				// an answer is the person's own words and analytics carries none.
				answeredCount: z.number().int().min(0).max(20),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("advisory_shown"),
		screen: z.literal("exit_advisory"),
		feature: z.literal("advisory"),
		status: z.literal("completed"),
		properties: z.object({ logicalId: z.string().trim().min(1).max(128) }).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("profile_created"),
		screen: z.literal("pisocamp_registration"),
		feature: z.literal("account"),
		status: z.literal("completed"),
		// Nothing about the person: AN-3 counts how many registered, and the
		// account itself is not analytics' to carry.
		properties: z.object({}).strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("link_open"),
		screen: z.literal("currency_detail"),
		feature: z.literal("currency_education"),
		status: z.literal("completed"),
		properties: z
			.object({
				// The kind of destination, never the destination itself: a URL is
				// content, and analytics carries none.
				linkType: z.enum(["external", "internal", "topic", "deep_link"]),
				logicalId: z.string().trim().min(1).max(128),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("module_load"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("module"),
		status: z.literal("completed"),
		properties: z
			.object({
				// A cold start pays for the process as well as the module, and
				// mixing the two would hide which of them got slower.
				phase: z.enum(["cold", "warm"]),
				// Capped at two minutes: anything longer is a device that gave up
				// or a clock that moved, not a load time worth a percentile.
				durationMs: z.number().int().min(0).max(120_000),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("network_failure"),
		screen: z.literal("pisocamp_home"),
		feature: z.literal("module"),
		// The one event whose status is a failure: it exists because something
		// did not work, so reporting it as completed would be a lie.
		status: z.literal("failed"),
		properties: z
			.object({
				failureType: z.enum(ANALYTICS_NETWORK_FAILURE_TYPES),
				// What was being attempted, never where: a URL is content.
				operation: z.enum(["config", "bundle", "asset", "events", "survey", "other"]),
			})
			.strict(),
	}).strict(),
	AnalyticsCommonSchema.extend({
		eventName: z.literal("feature_use"),
		screen: z.enum(ANALYTICS_FEATURE_USE_SCREENS),
		feature: z.enum(FEATURE_USE_FEATURES),
		status: z.literal("completed"),
		properties: z.object({ logicalId: z.string().trim().min(1).max(128) }).strict(),
	})
		.strict()
		.refine(
			event => ANALYTICS_FEATURE_USE_SCREENS[event.feature] === event.screen,
			"A feature_use event must name the screen that hosts its feature"
		),
])

function hasForbiddenKeySegment(key: string): boolean {
	const normalized = key
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
	return forbiddenKeySegments.some(segment => normalized.includes(segment))
}

function isEmailShaped(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isImagePayload(value: string): boolean {
	const compact = value.trim().replace(/\s/g, "")
	return (
		compact.toLowerCase().startsWith("data:image/") ||
		/^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)/.test(compact)
	)
}

function inspectForbiddenValues(value: unknown, path: PropertyKey[], ctx: z.RefinementCtx): void {
	if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
		ctx.addIssue({
			code: "custom",
			message: "Analytics events cannot contain byte arrays",
			path,
		})
		return
	}

	if (typeof value === "string") {
		if (isEmailShaped(value) || isImagePayload(value)) {
			ctx.addIssue({
				code: "custom",
				message: "Analytics events contain a forbidden data shape",
				path,
			})
		}
		return
	}

	if (Array.isArray(value)) {
		value.forEach((entry, index) => inspectForbiddenValues(entry, [...path, index], ctx))
		return
	}

	if (value !== null && typeof value === "object") {
		for (const [key, entry] of Object.entries(value)) {
			inspectForbiddenValues(entry, [...path, key], ctx)
		}
	}
}

function inspectForbiddenPropertyKeys(
	value: unknown,
	path: PropertyKey[],
	ctx: z.RefinementCtx
): void {
	if (Array.isArray(value)) {
		value.forEach((entry, index) => inspectForbiddenPropertyKeys(entry, [...path, index], ctx))
		return
	}

	if (value !== null && typeof value === "object") {
		for (const [key, entry] of Object.entries(value)) {
			if (hasForbiddenKeySegment(key)) {
				ctx.addIssue({
					code: "custom",
					message: "Analytics properties contain a forbidden key",
					path: [...path, key],
				})
			}
			inspectForbiddenPropertyKeys(entry, [...path, key], ctx)
		}
	}
}

export const AnalyticsEventSchema = AnalyticsEventCatalogSchema.superRefine((event, ctx) => {
	inspectForbiddenValues(event, [], ctx)
	inspectForbiddenPropertyKeys(event.properties, ["properties"], ctx)

	if (textEncoder.encode(JSON.stringify(event)).byteLength > EVENT_MAX_BYTES) {
		ctx.addIssue({
			code: "custom",
			message: "Analytics event exceeds the 8 KiB encoded limit",
		})
	}
})

export const IngestAnalyticsEventsInputSchema = z
	.object({ events: z.array(AnalyticsEventSchema).min(1).max(100) })
	.strict()
	.superRefine(({ events }, ctx) => {
		const eventIds = new Set<string>()
		for (const [index, event] of events.entries()) {
			if (eventIds.has(event.eventId)) {
				ctx.addIssue({
					code: "custom",
					message: "Analytics event IDs must be unique within a batch",
					path: ["events", index, "eventId"],
				})
			}
			eventIds.add(event.eventId)
		}

		if (textEncoder.encode(JSON.stringify({ events })).byteLength > BATCH_MAX_BYTES) {
			ctx.addIssue({
				code: "custom",
				message: "Analytics batch exceeds the 512 KiB encoded limit",
			})
		}
	})

export const IngestAnalyticsEventsOutputSchema = z
	.object({ ackedEventIds: z.array(UuidV4Schema).max(100) })
	.strict()
	.superRefine(({ ackedEventIds }, ctx) => {
		const eventIds = new Set<string>()
		for (const [index, eventId] of ackedEventIds.entries()) {
			if (eventIds.has(eventId)) {
				ctx.addIssue({
					code: "custom",
					message: "Acknowledged analytics event IDs must be unique",
					path: ["ackedEventIds", index],
				})
			}
			eventIds.add(eventId)
		}
	})

export const ModuleEntryTodaySchema = z
	.object({
		date: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		moduleEntryCount: z.number().int().nonnegative(),
	})
	.strict()

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>
export type IngestAnalyticsEventsInput = z.infer<typeof IngestAnalyticsEventsInputSchema>
export type IngestAnalyticsEventsOutput = z.infer<typeof IngestAnalyticsEventsOutputSchema>
export type ModuleEntryToday = z.infer<typeof ModuleEntryTodaySchema>
