import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { analyticsEvents, analyticsSessions } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { EngagementService } from "./engagement.service"
import { SessionizerService } from "./sessionizer.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const ADMIN_ID = "an2-admin"

/** Two subjects, so "per user" figures have something to divide by. */
const ALICE = "AnTwoAliceSubject00001"
const BOB = "AnTwoBobSubjectId00002"

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour: number, minute = 0) {
	return new Date(Date.UTC(2026, 7, day, hour - 8, minute))
}

function event(
	subjectPseudoId: string,
	occurredAt: Date,
  screen: "pisocamp_home" | "currency_detail"
) {
	return {
		eventId: randomUUID(),
		schemaVersion: 1,
		eventName: screen === "pisocamp_home" ? ("module_entry" as const) : ("content_view" as const),
		occurredAt,
		subjectPseudoId,
		sessionId: randomUUID(),
		accountType: "guest" as const,
		screen,
		feature: screen === "pisocamp_home" ? "module" : "currency_education",
		appVersion: "1.0.0",
		osName: "android" as const,
		osVersion: "15",
		deviceCategory: "phone" as const,
		networkState: "online" as const,
		status: "completed" as const,
		properties:
			screen === "pisocamp_home"
				? ({ entryPoint: "navigation" } as never)
				: ({ logicalId: "content.one" } as never),
	}
}

/**
 * AN-2. The figures are recomputed here by hand from a fixture small enough to
 * hold in your head, because a KPI nobody can reproduce is a KPI nobody should
 * act on.
 */
describe("AN-2 sessions and engagement KPIs", () => {
	let sessionizer: SessionizerService
	let engagement: EngagementService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table analytics_session, analytics_event, module_configuration, audit_log, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ADMIN_ID}, 'AN2 Admin', 'an2-admin@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		const config = new PisoCampAdminConfigService(new AuditService())
		sessionizer = new SessionizerService(config)
		engagement = new EngagementService(config)
		await db.delete(analyticsSessions)
		await db.delete(analyticsEvents)
		await db.execute(sql`delete from module_configuration`)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function setInactivityMinutes(minutes: number) {
		await db.execute(sql`
			insert into module_configuration (key, value, updated_by)
			values ('session_inactivity_minutes', ${minutes}::text::jsonb, ${ADMIN_ID})
			on conflict (key) do update set value = ${minutes}::text::jsonb
		`)
	}

	describe("AC1 — a session is a run of events with gaps under the inactivity", () => {
		it("cuts a session where the gap reaches the configured inactivity", async () => {
			await setInactivityMinutes(30)
			await db.insert(analyticsEvents).values([
				// One session: 10:00, 10:20, 10:35 — two gaps of 20 and 15.
				event(ALICE, manila(10, 10, 0), "pisocamp_home"),
				event(ALICE, manila(10, 10, 20), "currency_detail"),
				event(ALICE, manila(10, 10, 35), "currency_detail"),
				// A second session: 11:05 is 30 minutes after 10:35.
				event(ALICE, manila(10, 11, 5), "pisocamp_home"),
			])

			const result = await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-10" })

			expect(result.sessions).toBe(2)
			const sessions = await db
				.select()
				.from(analyticsSessions)
				.orderBy(analyticsSessions.startedAt)
			expect(sessions).toHaveLength(2)
			// 10:00 to 10:35 is 35 minutes, and three events on two screens is
			// two screen views: home, then currency detail.
			expect(sessions[0]).toMatchObject({
				subjectPseudoId: ALICE,
				localDate: "2026-08-10",
				durationSeconds: 35 * 60,
				eventCount: 3,
				screenViewCount: 2,
			})
			expect(sessions[1]).toMatchObject({ eventCount: 1, durationSeconds: 0 })
		})

		it("honours a different configured inactivity", async () => {
			await setInactivityMinutes(10)
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "pisocamp_home"),
				event(ALICE, manila(10, 10, 20), "pisocamp_home"),
			])

			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-10" })

			// The same 20-minute gap that was one session at 30 minutes is two
			// at 10, which is the setting doing its job.
			expect(await db.select().from(analyticsSessions)).toHaveLength(2)
		})

		it("keeps one subject's activity out of another's session", async () => {
			await setInactivityMinutes(30)
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "pisocamp_home"),
				event(BOB, manila(10, 10, 5), "pisocamp_home"),
			])

			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-10" })

			const sessions = await db.select().from(analyticsSessions)
			expect(sessions).toHaveLength(2)
			expect(sessions.map(row => row.subjectPseudoId).sort()).toEqual([ALICE, BOB])
		})

		it("counts a session on the Manila day it started", async () => {
			await setInactivityMinutes(60)
			await db.insert(analyticsEvents).values([
				// 23:30 Manila on the 10th, continuing past local midnight.
				event(ALICE, manila(10, 23, 30), "pisocamp_home"),
				event(ALICE, manila(11, 0, 15), "currency_detail"),
			])

			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-11" })

			const [session] = await db.select().from(analyticsSessions)
			// One session, on the day it began: cutting it at midnight would
			// invent a second visit nobody made.
			expect(session).toMatchObject({ localDate: "2026-08-10", eventCount: 2 })
		})

		it("rebuilds a window without counting anybody twice", async () => {
			await setInactivityMinutes(30)
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "pisocamp_home"),
			])

			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-10" })
			// A late upload lands, and the job runs again.
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 5), "currency_detail"),
			])
			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-10" })

			const sessions = await db.select().from(analyticsSessions)
			expect(sessions).toHaveLength(1)
			expect(sessions[0]).toMatchObject({ eventCount: 2, durationSeconds: 300 })
		})

		it("leaves sessions outside the window alone", async () => {
			await setInactivityMinutes(30)
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(9, 10, 0), "pisocamp_home"),
				event(ALICE, manila(11, 10, 0), "pisocamp_home"),
			])
			await sessionizer.rebuild({ from: "2026-08-09", to: "2026-08-11" })
			expect(await db.select().from(analyticsSessions)).toHaveLength(2)

			await sessionizer.rebuild({ from: "2026-08-11", to: "2026-08-11" })

			// The 9th's session is untouched by a rebuild of the 11th.
			expect(await db.select().from(analyticsSessions)).toHaveLength(2)
		})
	})

	describe("AC2 / AC3 — the figures reconcile with the raw events", () => {
		/**
		 * The fixture, by hand:
		 *
		 * 10 Aug — Alice 10:00, 10:20 (one session, 20 min, 2 screens)
		 *          Bob   14:00        (one session, 0 min, 1 screen)
		 * 11 Aug — Alice 09:00, 09:30 (two sessions at 30 min inactivity)
		 *
		 * Sessions 4, active users over the range 2, screen views 2+1+1+1 = 5.
		 */
		async function seedFixture() {
			await setInactivityMinutes(30)
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10, 0), "pisocamp_home"),
				event(ALICE, manila(10, 10, 20), "currency_detail"),
				event(BOB, manila(10, 14, 0), "pisocamp_home"),
				event(ALICE, manila(11, 9, 0), "pisocamp_home"),
				event(ALICE, manila(11, 9, 30), "pisocamp_home"),
			])
			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-11" })
		}

		it("reports sessions, users, duration and screen views per session", async () => {
			await seedFixture()

			const summary = await engagement.summary({ from: "2026-08-10", to: "2026-08-11" })

			expect(summary).toMatchObject({
				timezone: "Asia/Manila",
				sessionInactivityMinutes: 30,
				sessions: 4,
				activeUsers: 2,
				// 4 sessions / 2 users
				sessionsPerUser: 2,
				// (1200 + 0 + 0 + 0) / 4
				averageSessionSeconds: 300,
				// 5 screen views / 4 sessions
				screenViewsPerSession: 1.25,
			})
		})

		it("reports DAU, MAU and the ratio between them", async () => {
			await seedFixture()

			const summary = await engagement.summary({ from: "2026-08-10", to: "2026-08-11" })

			// On the 11th only Alice was active; over the rolling 30 days both were.
			expect(summary.dau).toBe(1)
			expect(summary.mau).toBe(2)
			expect(summary.dauMauPercent).toBe(50)
		})

		it("reports a day for every day in the range, including the empty ones", async () => {
			await seedFixture()

			const summary = await engagement.summary({ from: "2026-08-09", to: "2026-08-11" })

			expect(summary.dailyActive).toEqual([
				{ date: "2026-08-09", activeUsers: 0 },
				{ date: "2026-08-10", activeUsers: 2 },
				{ date: "2026-08-11", activeUsers: 1 },
			])
		})

		it("reports every hour, and the busy ones stand out", async () => {
			await seedFixture()

			const summary = await engagement.summary({ from: "2026-08-10", to: "2026-08-11" })

			expect(summary.hourly).toHaveLength(24)
			// Manila hours: Alice at 10:00, Bob at 14:00, Alice twice at 09:00.
			expect(summary.hourly.find(entry => entry.hour === 9)?.sessions).toBe(2)
			expect(summary.hourly.find(entry => entry.hour === 10)?.sessions).toBe(1)
			expect(summary.hourly.find(entry => entry.hour === 14)?.sessions).toBe(1)
			expect(summary.hourly.find(entry => entry.hour === 3)?.sessions).toBe(0)
		})

		it("reports the busiest five minutes by sessions open during it", async () => {
			await setInactivityMinutes(60)
			await db.insert(analyticsEvents).values([
				// Alice is active 10:00-10:40; Bob starts inside that.
				event(ALICE, manila(10, 10, 0), "pisocamp_home"),
				event(ALICE, manila(10, 10, 40), "currency_detail"),
				event(BOB, manila(10, 10, 30), "pisocamp_home"),
			])
			await sessionizer.rebuild({ from: "2026-08-10", to: "2026-08-10" })

			const summary = await engagement.summary({ from: "2026-08-10", to: "2026-08-10" })

			// Concurrency is sessions open, not sessions started: 10:30 has both.
			expect(summary.peakConcurrency?.sessions).toBe(2)
			expect(summary.peakConcurrency?.intervalStart).toBe("2026-08-10T02:30:00.000Z")
		})

		it("reports zeroes rather than a division by nothing", async () => {
			const summary = await engagement.summary({ from: "2026-08-10", to: "2026-08-11" })

			expect(summary).toMatchObject({
				sessions: 0,
				activeUsers: 0,
				dau: 0,
				mau: 0,
				dauMauPercent: 0,
				sessionsPerUser: 0,
				averageSessionSeconds: 0,
				screenViewsPerSession: 0,
				peakConcurrency: null,
			})
			expect(summary.hourly).toHaveLength(24)
		})
	})
})
