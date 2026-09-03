import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { ANALYTICS_EVENT_NAMES } from "@repo/contracts/pisocamp-analytics"
import { analyticsEvents } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

/**
 * Every event in the contract's catalog, with the screen and feature the
 * contract binds it to.
 *
 * Written out rather than derived, because the point is to state independently
 * what the database must accept. The `toEqual` below is what makes it a
 * drift test: an event added to the catalog and not to this table fails here,
 * and one added here and not to the database fails on insert.
 */
const CATALOG: Record<
	string,
	{
		screen: string
		feature: string
		properties: object
		/** Only `network_failure` reports anything but a completion. */
		status?: "completed" | "failed"
	}
> = {
	module_entry: {
		screen: "pisocamp_home",
		feature: "module",
		properties: { entryPoint: "navigation" },
	},
	account_prompt_shown: { screen: "pisocamp_home", feature: "account_prompt", properties: {} },
	account_prompt_guest: { screen: "pisocamp_home", feature: "account_prompt", properties: {} },
	content_view: {
		screen: "currency_detail",
		feature: "currency_education",
		properties: { logicalId: "content.one" },
	},
	link_open: {
		screen: "currency_detail",
		feature: "currency_education",
		properties: { linkType: "topic", logicalId: "content.one" },
	},
	feature_use: {
		screen: "coin_3d_viewer",
		feature: "3d_coin",
		properties: { logicalId: "content.one" },
	},
	trivia_prompt_shown: {
		screen: "trivia_prompt",
		feature: "trivia",
		properties: { logicalId: "content.one", category: "security-features", difficulty: "easy" },
	},
	trivia_prompt_answered: {
		screen: "trivia_prompt",
		feature: "trivia",
		properties: {
			logicalId: "content.one",
			category: "security-features",
			difficulty: "easy",
			correct: true,
			openedTopic: false,
		},
	},
	trivia_prompt_skipped: {
		screen: "trivia_prompt",
		feature: "trivia",
		properties: { logicalId: "content.one", category: "security-features", difficulty: "easy" },
	},
	survey_prompt_shown: {
		screen: "survey_prompt",
		feature: "survey",
		properties: { logicalId: "content.one", purpose: "satisfaction" },
	},
	survey_declined: {
		screen: "survey_prompt",
		feature: "survey",
		properties: { logicalId: "content.one", purpose: "satisfaction", stage: "prompt" },
	},
	survey_submitted: {
		screen: "survey_prompt",
		feature: "survey",
		properties: { logicalId: "content.one", purpose: "satisfaction", answeredCount: 3 },
	},
	advisory_shown: {
		screen: "exit_advisory",
		feature: "advisory",
		properties: { logicalId: "content.one" },
	},
	profile_created: {
		screen: "pisocamp_registration",
		feature: "account",
		properties: {},
	},
	ar_start: {
		screen: "ar_viewer",
		feature: "ar",
		properties: { logicalId: "content.one", outcome: "started" },
	},
	ar_end: {
		screen: "ar_viewer",
		feature: "ar",
		properties: { logicalId: "content.one", durationMs: 42000 },
	},
	first_open: {
		screen: "pisocamp_home",
		feature: "module",
		properties: {},
	},
	module_load: {
		screen: "pisocamp_home",
		feature: "module",
		properties: { phase: "cold", durationMs: 1450 },
	},
	network_failure: {
		screen: "pisocamp_home",
		feature: "module",
		properties: { failureType: "timeout", operation: "bundle" },
		// The one event that exists because something did not work.
		status: "failed",
	},
}

/**
 * The database's catalog has to admit every event the contract declares.
 *
 * It did not: AN-1 shipped four names, and CE-4, CE-5 and GM-2 added five more
 * to the contract without widening the CHECK, so a device emitting any of them
 * would have had its whole batch refused. This suite is the thing that would
 * have caught it, and is why EV-2's three new events could not repeat it.
 */
describe("the analytics catalog the database accepts", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.delete(analyticsEvents)
	})

	afterAll(async () => {
		await db.delete(analyticsEvents)
		await db.$client.end()
	})

	it("covers exactly the names the contract declares", () => {
		expect(Object.keys(CATALOG).sort()).toEqual([...ANALYTICS_EVENT_NAMES].sort())
	})

	it("accepts one of every event in the catalog", async () => {
		const rows = Object.entries(CATALOG).map(([eventName, shape], index) => ({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: eventName as never,
			occurredAt: new Date(Date.UTC(2026, 8, 2, 4, index)),
			subjectPseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
			sessionId: "8c479891-9c42-4550-b5a7-2ab6059c8a91",
			accountType: "guest" as const,
			screen: shape.screen,
			feature: shape.feature,
			appVersion: "1.0.0",
			osName: "android" as const,
			osVersion: "15",
			deviceCategory: "phone" as const,
			networkState: "online" as const,
			status: (shape.status ?? "completed") as never,
			properties: shape.properties as never,
		}))

		await db.insert(analyticsEvents).values(rows)

		const stored = await db.select({ eventName: analyticsEvents.eventName }).from(analyticsEvents)
		expect(stored.map(row => row.eventName).sort()).toEqual([...ANALYTICS_EVENT_NAMES].sort())
	})

	it("still refuses a name that is not in the catalog", async () => {
		await expect(
			db.execute(sql`
				insert into analytics_event (event_id, schema_version, event_name, occurred_at,
					subject_pseudo_id, session_id, account_type, screen, feature, app_version,
					os_name, os_version, device_category, network_state, status, properties)
				values (gen_random_uuid(), 1, 'survey_invented', now(), 'AbCdEfGhIjKlMnOpQrSt_-',
					'8c479891-9c42-4550-b5a7-2ab6059c8a91', 'guest', 'survey_prompt', 'survey',
					'1.0.0', 'android', '15', 'phone', 'online', 'completed', '{}'::jsonb)
			`)
			// Either constraint is a correct refusal: an unknown name satisfies
			// neither the name list nor any catalog branch.
		).rejects.toMatchObject({
			cause: { constraint: expect.stringMatching(/^analytics_event_(name|catalog)_check$/) },
		})
	})

	it("still refuses an event on a screen it does not belong to", async () => {
		await expect(
			db.execute(sql`
				insert into analytics_event (event_id, schema_version, event_name, occurred_at,
					subject_pseudo_id, session_id, account_type, screen, feature, app_version,
					os_name, os_version, device_category, network_state, status, properties)
				values (gen_random_uuid(), 1, 'survey_submitted', now(), 'AbCdEfGhIjKlMnOpQrSt_-',
					'8c479891-9c42-4550-b5a7-2ab6059c8a91', 'guest', 'pisocamp_home', 'survey',
					'1.0.0', 'android', '15', 'phone', 'online', 'completed', '{}'::jsonb)
			`)
		).rejects.toMatchObject({ cause: { constraint: "analytics_event_catalog_check" } })
	})
})
