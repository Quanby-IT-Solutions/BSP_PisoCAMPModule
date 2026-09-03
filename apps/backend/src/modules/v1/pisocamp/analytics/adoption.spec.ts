import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { analyticsEvents } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { AdoptionService } from "./adoption.service"

const ALICE = "AnThreeAliceSubject001"
const BOB = "AnThreeBobSubjectId002"
const CARA = "AnThreeCaraSubjectId03"

function manila(day: number, hour: number, minute = 0) {
	return new Date(Date.UTC(2026, 7, day, hour - 8, minute))
}

type Shape = {
	eventName: string
	screen: string
	feature: string
	properties: Record<string, unknown>
	/** Only the events that exist because something did not work declare one. */
	status?: "completed" | "failed"
}

const SHAPES: Record<string, Shape> = {
	module_entry: {
		eventName: "module_entry",
		screen: "pisocamp_home",
		feature: "module",
		properties: { entryPoint: "navigation" },
	},
	account_prompt_shown: {
		eventName: "account_prompt_shown",
		screen: "pisocamp_home",
		feature: "account_prompt",
		properties: {},
	},
	profile_created: {
		eventName: "profile_created",
		screen: "pisocamp_registration",
		feature: "account",
		properties: {},
	},
	content_view_banknote: {
		eventName: "content_view",
		screen: "currency_detail",
		feature: "currency_education",
		properties: { logicalId: "catalog.ngc-banknotes.php-20" },
	},
	content_view_coin: {
		eventName: "content_view",
		screen: "currency_detail",
		feature: "currency_education",
		properties: { logicalId: "catalog.ngc-coins.php-1" },
	},
	feature_use_3d: {
		eventName: "feature_use",
		screen: "coin_3d_viewer",
		feature: "3d_coin",
		properties: { logicalId: "content.one" },
	},
	ar_started: {
		eventName: "ar_start",
		screen: "ar_viewer",
		feature: "ar",
		properties: { logicalId: "content.one", outcome: "started" },
	},
	ar_unsupported: {
		eventName: "ar_start",
		screen: "ar_viewer",
		feature: "ar",
		properties: { logicalId: "content.one", outcome: "unsupported" },
	},
	recognition_recognized: {
		eventName: "recognition_result",
		screen: "recognition_scanner",
		feature: "recognition",
		properties: { outcome: "recognized", elapsedMs: 640 },
	},
	recognition_unavailable: {
		eventName: "recognition_result",
		screen: "recognition_scanner",
		feature: "recognition",
		status: "failed",
		properties: { outcome: "unavailable", elapsedMs: 0 },
	},
	link_open_external: {
		eventName: "link_open",
		screen: "currency_detail",
		feature: "currency_education",
		properties: { linkType: "external", logicalId: "content.one" },
	},
}

function event(subjectPseudoId: string, occurredAt: Date, shape: keyof typeof SHAPES) {
	const kind = SHAPES[shape]!
	return {
		eventId: randomUUID(),
		schemaVersion: 1,
		eventName: kind.eventName as never,
		occurredAt,
		subjectPseudoId,
		sessionId: randomUUID(),
		accountType: "guest" as const,
		screen: kind.screen,
		feature: kind.feature,
		appVersion: "1.0.0",
		osName: "android" as const,
		osVersion: "15",
		deviceCategory: "phone" as const,
		networkState: "online" as const,
		status: (kind.status ?? "completed") as never,
		properties: kind.properties as never,
	}
}

/**
 * AN-3. Every rate is recomputed by hand from a fixture of three people,
 * because a KPI nobody can reproduce is a KPI nobody should act on.
 */
describe("AN-3 adoption and feature usage", () => {
	let adoption: AdoptionService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`truncate table analytics_session, analytics_event restart identity cascade`)
	})

	beforeEach(async () => {
		adoption = new AdoptionService()
		await db.delete(analyticsEvents)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	const range = { from: "2026-08-10", to: "2026-08-11" }

	describe("AC1 — account creation rate", () => {
		it("is registered over prompted, as a percentage", async () => {
			await db.insert(analyticsEvents).values([
				// Three prompted, one of whom registered.
				event(ALICE, manila(10, 10, 0), "account_prompt_shown"),
				event(BOB, manila(10, 10, 0), "account_prompt_shown"),
				event(CARA, manila(10, 10, 0), "account_prompt_shown"),
				event(ALICE, manila(10, 10, 5), "profile_created"),
			])

			const summary = await adoption.summary(range)

			expect(summary).toMatchObject({
				promptedUsers: 3,
				registeredUsers: 1,
				// 1 / 3 = 33.33%
				accountCreationRatePercent: 33.33,
			})
		})

		it("counts a person once however many times they were prompted", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "account_prompt_shown"),
				event(ALICE, manila(10, 11, 0), "account_prompt_shown"),
			])

			expect((await adoption.summary(range)).promptedUsers).toBe(1)
		})

		it("reports zero rather than dividing by nobody", async () => {
			expect((await adoption.summary(range)).accountCreationRatePercent).toBe(0)
		})
	})

	describe("AC2 — time to first key action and first-day activation", () => {
		it("measures from a person's first entry to their first key action", async () => {
			await db.insert(analyticsEvents).values([
				// Alice: entry 10:00, first key action 10:10 -> 600 seconds.
				event(ALICE, manila(10, 10, 0), "module_entry"),
				event(ALICE, manila(10, 10, 10), "content_view_banknote"),
				// Bob: entry 10:00, first key action 10:30 -> 1800 seconds.
				event(BOB, manila(10, 10, 0), "module_entry"),
				event(BOB, manila(10, 10, 30), "feature_use_3d"),
				// Cara: entry 10:00, key action 40 hours later -> not first-day.
				event(CARA, manila(10, 10, 0), "module_entry"),
				event(CARA, manila(11, 2, 0), "content_view_coin"),
			])

			const summary = await adoption.summary(range)

			// Three people, seconds 600, 1800 and 57600: the median is 1800.
			expect(summary.timeToFirstKeyActionMedianSeconds).toBe(1800)
			expect(summary.enteredUsers).toBe(3)
			// Cara's action is 16 hours later, which is within the day.
			expect(summary.firstDayActivatedUsers).toBe(3)
			expect(summary.firstDayActivationRatePercent).toBe(100)
		})

		it("does not count an action more than a day after the first entry", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 8, 0), "module_entry"),
				// 25 hours later, which is a return visit rather than activation.
				event(ALICE, manila(11, 9, 0), "content_view_banknote"),
			])

			const summary = await adoption.summary(range)

			expect(summary.enteredUsers).toBe(1)
			expect(summary.firstDayActivatedUsers).toBe(0)
			expect(summary.firstDayActivationRatePercent).toBe(0)
			// The timing is still reported: it took that long.
			expect(summary.timeToFirstKeyActionMedianSeconds).toBe(25 * 3600)
		})

		it("reports no timing at all when nobody acted", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "module_entry"),
			])

			const summary = await adoption.summary(range)

			// Null rather than zero: nobody acted is not "acted instantly".
			expect(summary.timeToFirstKeyActionMedianSeconds).toBeNull()
			expect(summary.timeToFirstKeyActionP95Seconds).toBeNull()
			expect(summary.firstDayActivationRatePercent).toBe(0)
		})

		it("names the key actions it counted", async () => {
			const summary = await adoption.summary(range)

			expect(summary.keyActionEvents).toEqual([
				"content_view",
				"feature_use",
				"trivia_prompt_answered",
				"survey_submitted",
			])
		})
	})

	describe("AC3 — usage per AN-013 feature", () => {
		it("reports every feature, including the ones nothing emits yet", async () => {
			const summary = await adoption.summary(range)

			expect(summary.features).toHaveLength(15)
			// "Not built" and "not used" are different answers, and a missing row
			// would read as the second.
			expect(summary.features.find(entry => entry.feature === "ar")).toEqual({
				feature: "ar",
				uses: 0,
				users: 0,
			})
			expect(summary.features.map(entry => entry.feature)).toContain("leaderboard")
			expect(summary.features.map(entry => entry.feature)).toContain("recognition")
		})

		it("separates banknotes, coins, viewers and links", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "content_view_banknote"),
				event(BOB, manila(10, 10, 0), "content_view_banknote"),
				event(ALICE, manila(10, 10, 5), "content_view_coin"),
				event(ALICE, manila(10, 10, 10), "feature_use_3d"),
				event(ALICE, manila(10, 10, 15), "link_open_external"),
			])

			const summary = await adoption.summary(range)
			const usage = new Map(summary.features.map(entry => [entry.feature, entry]))

			expect(usage.get("banknotes")).toMatchObject({ uses: 2, users: 2 })
			expect(usage.get("coins")).toMatchObject({ uses: 1, users: 1 })
			expect(usage.get("3d_coin")).toMatchObject({ uses: 1, users: 1 })
			expect(usage.get("external_link")).toMatchObject({ uses: 1, users: 1 })
			expect(usage.get("internal_link")).toMatchObject({ uses: 0, users: 0 })
		})

		it("counts an attempt that could not run as nobody using the feature", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "ar_started"),
				event(BOB, manila(10, 10, 1), "ar_unsupported"),
				event(ALICE, manila(10, 10, 2), "recognition_recognized"),
				event(BOB, manila(10, 10, 3), "recognition_unavailable"),
			])

			const summary = await adoption.summary(range)
			const usage = new Map(summary.features.map(entry => [entry.feature, entry]))

			// A phone that cannot open augmented reality, and a reader that was
			// never downloaded, are not somebody using either feature. What broke
			// is AN-7's question; this report answers AN-013's.
			expect(usage.get("ar")).toMatchObject({ uses: 1, users: 1 })
			expect(usage.get("recognition")).toMatchObject({ uses: 1, users: 1 })
		})

		it("counts uses and users separately", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "feature_use_3d"),
				event(ALICE, manila(10, 10, 5), "feature_use_3d"),
				event(ALICE, manila(10, 10, 9), "feature_use_3d"),
			])

			const summary = await adoption.summary(range)
			const viewer = summary.features.find(entry => entry.feature === "3d_coin")

			// One person using it three times is three uses and one user.
			expect(viewer).toMatchObject({ uses: 3, users: 1 })
		})

		it("ignores activity outside the range", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(9, 23, 59), "content_view_banknote"),
				event(ALICE, manila(12, 0, 1), "content_view_banknote"),
			])

			const summary = await adoption.summary(range)

			expect(
				summary.features.find(entry => entry.feature === "banknotes")
			).toMatchObject({ uses: 0 })
		})
	})
})
