import { describe, expect, it } from "vitest"

import { v1Contract } from "../v1.contract.js"
import { pisoCampAnalyticsContract } from "./analytics.contract.js"
import {
	ANALYTICS_EVENT_NAMES,
	ANALYTICS_FEATURE_USE_SCREENS,
	AnalyticsEventSchema,
	IngestAnalyticsEventsInputSchema,
	IngestAnalyticsEventsOutputSchema,
	ModuleEntryTodaySchema,
} from "./analytics.schema.js"
import vectors from "./fixtures/an1-event-vectors.json"

const moduleEntry = vectors[0]!
const contentView = vectors[3]!

const forbiddenFreeTextCases = [
	{
		field: "appVersion",
		shape: "email",
		event: { ...moduleEntry, appVersion: "person@example.com" },
	},
	{
		field: "appVersion",
		shape: "data-image",
		event: { ...moduleEntry, appVersion: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA" },
	},
	{
		field: "appVersion",
		shape: "base64-image",
		event: { ...moduleEntry, appVersion: "iVBORw0KGgoAAAANSUhEUgAA" },
	},
	{
		field: "osVersion",
		shape: "email",
		event: { ...moduleEntry, osVersion: "person@example.com" },
	},
	{
		field: "osVersion",
		shape: "data-image",
		event: { ...moduleEntry, osVersion: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA" },
	},
	{
		field: "osVersion",
		shape: "base64-image",
		event: { ...moduleEntry, osVersion: "iVBORw0KGgoAAAANSUhEUgAA" },
	},
	{
		field: "properties.logicalId",
		shape: "email",
		event: { ...contentView, properties: { logicalId: "person@example.com" } },
	},
	{
		field: "properties.logicalId",
		shape: "data-image",
		event: {
			...contentView,
			properties: { logicalId: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA" },
		},
	},
	{
		field: "properties.logicalId",
		shape: "base64-image",
		event: { ...contentView, properties: { logicalId: "iVBORw0KGgoAAAANSUhEUgAA" } },
	},
] as const

function withEventId(index: number) {
	return {
		...moduleEntry,
		eventId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
	}
}

describe("AN-1 analytics event catalog", () => {
	it("accepts every registered shared event vector", () => {
		expect(vectors.map(vector => AnalyticsEventSchema.parse(vector))).toEqual(vectors)
		expect(ANALYTICS_EVENT_NAMES).toEqual([
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
			"first_open",
			"ar_start",
			"ar_end",
		])
	})

	it("binds a feature_use to the one screen that hosts its feature", () => {
		const featureUse = vectors.find(vector => vector.eventName === "feature_use")
		expect(featureUse).toBeDefined()
		expect(ANALYTICS_FEATURE_USE_SCREENS).toEqual({
			"3d_coin": "coin_3d_viewer",
			haptic: "tactile_viewer",
			tilt: "tilt_viewer",
		})

		expect(
			AnalyticsEventSchema.safeParse({ ...featureUse, screen: "currency_detail" }).success
		).toBe(false)
		expect(AnalyticsEventSchema.safeParse({ ...featureUse, feature: "ar_coin" }).success).toBe(
			false
		)
		// A known feature reported from another feature's screen is still wrong.
		expect(
			AnalyticsEventSchema.safeParse({ ...featureUse, feature: "haptic" }).success
		).toBe(false)
		expect(
			AnalyticsEventSchema.safeParse({
				...featureUse,
				feature: "haptic",
				screen: "tactile_viewer",
			}).success
		).toBe(true)
		expect(
			AnalyticsEventSchema.safeParse({
				...featureUse,
				properties: { logicalId: "catalog.ngc-coins.php-1", frames: 42 },
			}).success
		).toBe(false)
	})

	it("rejects unregistered names and unknown event or property fields", () => {
		for (const event of [
			{ ...moduleEntry, eventName: "screen_view" },
			{ ...moduleEntry, unexpected: true },
			{ ...moduleEntry, properties: { entryPoint: "navigation", campaign: "launch" } },
		]) {
			expect(AnalyticsEventSchema.safeParse(event).success).toBe(false)
		}
	})

	it("rejects malformed identifiers, pseudonyms, timestamps, and enumerations", () => {
		for (const event of [
			{ ...moduleEntry, eventId: "not-a-uuid" },
			{ ...moduleEntry, eventId: "0190f49b-57a8-3b85-9d0e-5e274f0e4aa1" },
			{ ...moduleEntry, sessionId: "0190f49b-57a8-3b85-9d0e-5e274f0e4aa1" },
			{ ...moduleEntry, subjectPseudoId: "short" },
			{ ...moduleEntry, occurredAt: "2026-08-30" },
			{ ...moduleEntry, accountType: "administrator" },
			{ ...moduleEntry, osName: "windows" },
			{ ...moduleEntry, deviceCategory: "desktop" },
			{ ...moduleEntry, networkState: "metered" },
		]) {
			expect(AnalyticsEventSchema.safeParse(event).success).toBe(false)
		}
	})

	it("rejects duplicate event identifiers in an ingestion request", () => {
		expect(
			IngestAnalyticsEventsInputSchema.safeParse({ events: [moduleEntry, moduleEntry] }).success
		).toBe(false)
	})

	it.each(forbiddenFreeTextCases)(
		"rejects a $shape value in the complete event field $field",
		({ event }) => {
			expect(AnalyticsEventSchema.safeParse(event).success).toBe(false)
		}
	)

	it.each(["displayName", "full_name", "user-name"])(
		"rejects the unknown name-like property key %s by behavior",
		key => {
			expect(
				AnalyticsEventSchema.safeParse({
					...contentView,
					properties: { ...contentView.properties, [key]: "Ada" },
				}).success
			).toBe(false)
		}
	)

	it("rejects byte arrays in event properties", () => {
		expect(
			AnalyticsEventSchema.safeParse({
				...contentView,
				properties: { logicalId: new Uint8Array([137, 80, 78, 71]) },
			}).success
		).toBe(false)
	})

	it("does not treat fixed schema keys containing denylist substrings as dynamic payload keys", () => {
		expect(AnalyticsEventSchema.parse(moduleEntry).eventName).toBe("module_entry")
	})

	it("rejects encoded events and batches that exceed their declared byte limits", () => {
		expect(
			AnalyticsEventSchema.safeParse({
				...contentView,
				properties: { logicalId: "x".repeat(8_193) },
			}).success
		).toBe(false)
		expect(
			IngestAnalyticsEventsInputSchema.safeParse({
				events: [
					{
						...contentView,
						properties: { logicalId: "x".repeat(512 * 1024) },
					},
				],
			}).success
		).toBe(false)
	})

	it("enforces the one-to-one-hundred event request range", () => {
		expect(IngestAnalyticsEventsInputSchema.safeParse({ events: [] }).success).toBe(false)
		expect(
			IngestAnalyticsEventsInputSchema.safeParse({
				events: Array.from({ length: 101 }, (_, index) => withEventId(index)),
			}).success
		).toBe(false)
	})

	it("preserves acknowledgement identifier order while rejecting repeated acknowledgements", () => {
		const acknowledged = [contentView.eventId, moduleEntry.eventId]
		expect(IngestAnalyticsEventsOutputSchema.parse({ ackedEventIds: acknowledged })).toEqual({
			ackedEventIds: acknowledged,
		})
		expect(
			IngestAnalyticsEventsOutputSchema.safeParse({
				ackedEventIds: [moduleEntry.eventId, moduleEntry.eventId],
			}).success
		).toBe(false)
	})

	it("exposes a strict Manila module-entry summary", () => {
		const summary = {
			date: "2026-08-30",
			timezone: "Asia/Manila",
			moduleEntryCount: 12,
		}
		expect(ModuleEntryTodaySchema.parse(summary)).toEqual(summary)
		expect(ModuleEntryTodaySchema.safeParse({ ...summary, extra: true }).success).toBe(false)
	})
})

describe("AN-1 analytics routes", () => {
	it("registers the public ingestion endpoint at its exact v1 path", () => {
		const route = pisoCampAnalyticsContract.events.ingest["~orpc"].route
		expect(route).toMatchObject({ method: "POST", path: "/pisocamp/events" })
		expect(route.spec).toBeTypeOf("function")
		expect(
			(route.spec as (spec: { security?: unknown }) => { security?: unknown })({}).security
		).toEqual([])
		expect(v1Contract.pisocamp.events.ingest["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/v1/pisocamp/events",
		})
	})

	it("registers the authenticated module-entry summary endpoint at its exact v1 path", () => {
		const route = pisoCampAnalyticsContract.analytics.moduleEntryToday["~orpc"].route
		expect(route).toMatchObject({
			method: "GET",
			path: "/admin/pisocamp/analytics/module-entry-today",
		})
		expect(route.spec).toBeUndefined()
		expect(v1Contract.pisocamp.analytics.moduleEntryToday["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/v1/admin/pisocamp/analytics/module-entry-today",
		})
	})
})
