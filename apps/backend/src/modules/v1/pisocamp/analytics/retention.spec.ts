import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { analyticsSessions } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { RetentionService } from "./retention.service"

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

const ADMIN_ID = "an4-admin"

/** Four subjects, so every rate has something to divide by. */
const ALICE = "AnFourAliceSubject0001"
const BOB = "AnFourBobSubjectId0002"
const CARA = "AnFourCaraSubjectId003"
const DAN = "AnFourDanSubjectId0004"

/** A session on one Manila day. Nothing here cares what happened inside it. */
function session(subjectPseudoId: string, localDate: string) {
	const startedAt = new Date(`${localDate}T02:00:00.000Z`)
	return {
		id: randomUUID(),
		subjectPseudoId,
		startedAt,
		endedAt: new Date(startedAt.getTime() + 300_000),
		localDate,
		durationSeconds: 300,
		eventCount: 2,
		screenViewCount: 1,
	}
}

/**
 * AN-4. Every figure is recomputed here by hand from a fixture small enough to
 * hold in your head, because a retention number nobody can reproduce is a
 * retention number nobody should plan against.
 */
describe("AN-4 retention, churn, lifetime and reactivation", () => {
	let retention: RetentionService

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
			values (${ADMIN_ID}, 'AN4 Admin', 'an4-admin@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		retention = new RetentionService(new PisoCampAdminConfigService(new AuditService()))
		await db.delete(analyticsSessions)
		await db.execute(sql`delete from module_configuration`)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function setChurnDays(days: number) {
		await db.execute(sql`
			insert into module_configuration (key, value, updated_by)
			values ('churn_inactivity_days', ${days}::text::jsonb, ${ADMIN_ID})
			on conflict (key) do update set value = ${days}::text::jsonb
		`)
	}

	describe("AC1 - D1, D7 and D30 retention per cohort", () => {
		/**
		 * The cohort of 1 March, by hand:
		 *
		 * Alice - 01, 02, 08, 31 March -> back on D1, D7 and D30
		 * Bob   - 01, 02 March         -> back on D1 only
		 * Cara  - 01 March             -> never back
		 *
		 * So D1 is 2 of 3, D7 is 1 of 3, D30 is 1 of 3.
		 */
		async function seedCohort() {
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-03-01"),
				session(ALICE, "2026-03-02"),
				session(ALICE, "2026-03-08"),
				session(ALICE, "2026-03-31"),
				session(BOB, "2026-03-01"),
				session(BOB, "2026-03-02"),
				session(CARA, "2026-03-01"),
			])
		}

		it("counts the cohort by first ever activity and reports each day", async () => {
			await seedCohort()

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			expect(summary.cohorts).toHaveLength(1)
			expect(summary.cohorts[0]).toEqual({
				cohortDate: "2026-03-01",
				users: 3,
				d1: { retainedUsers: 2, percent: 66.67 },
				d7: { retainedUsers: 1, percent: 33.33 },
				d30: { retainedUsers: 1, percent: 33.33 },
			})
		})

		it("counts a return on the day itself, not on or after it", async () => {
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-03-01"),
				// Back on day 2 and day 8, so neither the D1 nor the D7 day.
				session(ALICE, "2026-03-03"),
				session(ALICE, "2026-03-09"),
			])

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			// Coming back at some point and coming back the next day are
			// different facts, and only the second is comparable between cohorts.
			expect(summary.cohorts[0]?.d1).toEqual({ retainedUsers: 0, percent: 0 })
			expect(summary.cohorts[0]?.d7).toEqual({ retainedUsers: 0, percent: 0 })
		})

		it("reports null for a day the cohort has not lived through yet", async () => {
			await seedCohort()

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-03-08" })

			expect(summary.cohorts[0]?.d1).toEqual({ retainedUsers: 2, percent: 66.67 })
			expect(summary.cohorts[0]?.d7).toEqual({ retainedUsers: 1, percent: 33.33 })
			// The 31st has not happened inside this report. Nought per cent would
			// report a failure the cohort has not had the chance to have.
			expect(summary.cohorts[0]?.d30).toBeNull()
		})

		it("puts somebody in the cohort of their first ever day, not their first in range", async () => {
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-02-01"),
				session(ALICE, "2026-03-01"),
				session(BOB, "2026-03-01"),
			])

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			// Alice is a February user. Counting her as new in March would invent
			// an acquisition that never happened.
			expect(summary.cohorts).toEqual([
				expect.objectContaining({ cohortDate: "2026-03-01", users: 1 }),
			])
		})

		it("ignores activity after the report end so a past range stays reproducible", async () => {
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-03-01"),
				session(ALICE, "2026-03-02"),
			])

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-03-01" })

			// The 2nd is outside the report, so D1 has not elapsed within it.
			expect(summary.cohorts[0]).toEqual({
				cohortDate: "2026-03-01",
				users: 1,
				d1: null,
				d7: null,
				d30: null,
			})
		})
	})

	describe("AC2 - churn, re-engagement and reactivation at the configured period", () => {
		/**
		 * With a 30-day inactivity period and a report ending 30 April:
		 *
		 * Alice - last seen 31 March. 30 April minus 31 March is 30 days, which
		 *         is not *more* than 30, so she is quiet but not churned.
		 * Bob   - last seen 2 March, 59 days quiet -> churned.
		 * Cara  - last seen 1 March, 60 days quiet -> churned.
		 * Dan   - active 30 April -> not churned.
		 *
		 * Churn is 2 of 4 known users, which is 50%.
		 */
		async function seedChurn() {
			await setChurnDays(30)
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-03-31"),
				session(BOB, "2026-03-02"),
				session(CARA, "2026-03-01"),
				session(DAN, "2026-04-30"),
			])
		}

		it("counts somebody churned only after more than the configured period", async () => {
			await seedChurn()

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			expect(summary).toMatchObject({
				churnInactivityDays: 30,
				knownUsers: 4,
				churnedUsers: 2,
				churnRatePercent: 50,
			})
		})

		it("moves the churn line when the configuration moves", async () => {
			await seedChurn()
			await setChurnDays(60)

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			// At 60 days Cara's 60-day silence is still not past the line - 60 is
			// not more than 60 - so nobody has churned.
			expect(summary).toMatchObject({ churnInactivityDays: 60, churnedUsers: 0 })
		})

		it("falls back to thirty days when nothing is configured", async () => {
			await db.insert(analyticsSessions).values([session(ALICE, "2026-03-01")])

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			expect(summary.churnInactivityDays).toBe(30)
		})

		/**
		 * Pools measured at the range start, 1 April, with a 30-day period:
		 *
		 * Alice - last seen 31 March, 1 day quiet -> still active, in neither pool
		 * Bob   - last seen 20 March, 12 days quiet -> lapsed, and returns in April
		 * Cara  - last seen 10 March, 22 days quiet -> lapsed, and does not return
		 * Dan   - last seen 1 January, 90 days quiet -> churned, and returns
		 *
		 * Re-engagement is 1 of 2 lapsed; reactivation is 1 of 1 churned.
		 */
		async function seedReturns() {
			await setChurnDays(30)
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-03-31"),
				session(BOB, "2026-03-20"),
				session(BOB, "2026-04-05"),
				session(CARA, "2026-03-10"),
				session(DAN, "2026-01-01"),
				session(DAN, "2026-04-06"),
			])
		}

		it("separates coming back from coming back after churning", async () => {
			await seedReturns()

			const summary = await retention.summary({ from: "2026-04-01", to: "2026-04-30" })

			expect(summary).toMatchObject({
				lapsedAtRangeStart: 2,
				reengagedUsers: 1,
				reengagementRatePercent: 50,
				churnedAtRangeStart: 1,
				reactivatedUsers: 1,
				reactivationRatePercent: 100,
			})
		})

		it("does not count somebody who never went away as re-engaged", async () => {
			await seedReturns()
			await db.insert(analyticsSessions).values([session(ALICE, "2026-04-02")])

			const summary = await retention.summary({ from: "2026-04-01", to: "2026-04-30" })

			// Alice was here the day before the range. Returning is something you
			// can only do after leaving.
			expect(summary).toMatchObject({ lapsedAtRangeStart: 2, reengagedUsers: 1 })
		})

		it("reports zero rather than dividing by an empty pool", async () => {
			await setChurnDays(30)
			await db.insert(analyticsSessions).values([session(ALICE, "2026-04-10")])

			const summary = await retention.summary({ from: "2026-04-01", to: "2026-04-30" })

			expect(summary).toMatchObject({
				lapsedAtRangeStart: 0,
				reengagementRatePercent: 0,
				churnedAtRangeStart: 0,
				reactivationRatePercent: 0,
			})
		})
	})

	describe("AC3 - lifetime is last qualifying activity minus first", () => {
		it("measures each lifetime and reports the average and median", async () => {
			await setChurnDays(30)
			await db.insert(analyticsSessions).values([
				// Alice: 1 to 31 March is 30 days.
				session(ALICE, "2026-03-01"),
				session(ALICE, "2026-03-31"),
				// Bob: 1 to 11 March is 10 days.
				session(BOB, "2026-03-01"),
				session(BOB, "2026-03-11"),
				// Cara: one day only, so nothing elapsed.
				session(CARA, "2026-03-05"),
			])

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			// (30 + 10 + 0) / 3 = 13.33, and the middle of 0, 10, 30 is 10.
			expect(summary).toMatchObject({
				averageLifetimeDays: 13.33,
				medianLifetimeDays: 10,
			})
		})

		it("stops a lifetime at the report end, not at today", async () => {
			await setChurnDays(30)
			await db.insert(analyticsSessions).values([
				session(ALICE, "2026-03-01"),
				session(ALICE, "2026-03-11"),
				// After the report end: it belongs to a later report.
				session(ALICE, "2026-05-01"),
			])

			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			expect(summary.averageLifetimeDays).toBe(10)
		})

		it("reports no lifetime at all rather than a lifetime of nothing", async () => {
			const summary = await retention.summary({ from: "2026-03-01", to: "2026-04-30" })

			// Nobody known is not the same as everybody lasting no time.
			expect(summary).toMatchObject({
				knownUsers: 0,
				churnRatePercent: 0,
				averageLifetimeDays: null,
				medianLifetimeDays: null,
				cohorts: [],
			})
		})
	})
})
