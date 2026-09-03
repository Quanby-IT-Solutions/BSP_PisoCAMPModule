import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import {
	leaderboardEntries,
	pisoCampCities,
	pisoCampProfiles,
	pisoCampRegions,
	triviaResponses,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { generatedAlias, PisoCampLeaderboardService } from "./leaderboard.service"

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

const ADMIN_ID = "gm4-admin"
const ALICE = "gm4-alice"
const BOB = "gm4-bob"
const CARA = "gm4-cara"

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(year: number, month: number, day: number, hour = 10) {
	return new Date(Date.UTC(year, month - 1, day, hour - 8))
}

/**
 * GM-4. The board is derived from `trivia_response` and nothing else, so every
 * figure here is reconciled against the answers that produced it.
 */
describe("GM-4 leaderboard", () => {
	let service: PisoCampLeaderboardService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table leaderboard_entry, trivia_response, module_configuration,
			piso_camp_profile, city, region, audit_log, sessions, accounts, users
			restart identity cascade
		`)
		await db.execute(sql`truncate table consent_record restart identity cascade`)
		await db.execute(sql`truncate table privacy_notice restart identity cascade`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[ADMIN_ID, ALICE, BOB, CARA].map(id => ({
				id,
				name: `GM-4 ${id}`,
				email: `${id}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		await db.execute(sql`
			insert into module_configuration (key, value, updated_by)
			values ('leaderboard_enabled', 'true'::jsonb, ${ADMIN_ID})
		`)
		service = new PisoCampLeaderboardService(
			new PisoCampAdminConfigService(new AuditService())
		)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function answer(accountId: string, at: Date, points: number) {
		await db.insert(triviaResponses).values({
			responseId: randomUUID(),
			accountId,
			contentItemId: randomUUID(),
			contentVersionId: randomUUID(),
			category: "banknotes",
			difficulty: "easy",
			correct: points > 0,
			skipped: false,
			linkOpened: false,
			points,
			answeredAt: at,
		})
	}

	describe("the periods", () => {
		it("starts a week on the Monday of the Manila day", () => {
			// 3 September 2026 is a Thursday; its week began on the 31st of August.
			expect(service.periodStart("weekly", manila(2026, 9, 3))).toBe("2026-08-31")
			expect(service.periodStart("weekly", manila(2026, 8, 31))).toBe("2026-08-31")
			// Sunday belongs to the week that began six days earlier, not the next.
			expect(service.periodStart("weekly", manila(2026, 9, 6))).toBe("2026-08-31")
			expect(service.periodStart("weekly", manila(2026, 9, 7))).toBe("2026-09-07")
		})

		it("starts a month on the first Manila day of it", () => {
			expect(service.periodStart("monthly", manila(2026, 9, 30))).toBe("2026-09-01")
		})

		it("pins all time to one day, so it never rolls over", () => {
			expect(service.periodStart("all_time", manila(2026, 9, 3))).toBe(
				service.periodStart("all_time", manila(2027, 1, 1))
			)
		})
	})

	describe("AC1 / GM-008 — the board reconciles with the answers", () => {
		/**
		 * The week of 31 August, by hand:
		 *
		 * Alice — 10 + 20 = 30 → first
		 * Bob   — 25        → second
		 * Cara  — 25        → also second, so nobody is third
		 */
		async function seedWeek() {
			await answer(ALICE, manila(2026, 8, 31), 10)
			await answer(ALICE, manila(2026, 9, 2), 20)
			await answer(BOB, manila(2026, 9, 1), 25)
			await answer(CARA, manila(2026, 9, 3), 25)
		}

		it("sums the points in the period and ranks by them", async () => {
			await seedWeek()

			await service.rebuild("weekly", manila(2026, 9, 3))

			const rows = await db
				.select()
				.from(leaderboardEntries)
				.orderBy(leaderboardEntries.rank, leaderboardEntries.accountId)
			expect(rows.map(row => [row.accountId, row.score, row.rank])).toEqual([
				[ALICE, 30, 1],
				[BOB, 25, 2],
				[CARA, 25, 2],
			])
		})

		it("leaves out answers from another week", async () => {
			await seedWeek()
			// The following Monday: a new week, and not this board's business.
			await answer(BOB, manila(2026, 9, 7), 100)

			await service.rebuild("weekly", manila(2026, 9, 3))

			const [bob] = await db
				.select()
				.from(leaderboardEntries)
				.where(eq(leaderboardEntries.accountId, BOB))
			expect(bob?.score).toBe(25)
		})

		it("counts everything ever for all time", async () => {
			await seedWeek()
			await answer(BOB, manila(2026, 9, 7), 100)

			await service.rebuild("all_time", manila(2026, 9, 7))

			const [bob] = await db
				.select()
				.from(leaderboardEntries)
				.where(eq(leaderboardEntries.accountId, BOB))
			expect(bob).toMatchObject({ score: 125, rank: 1 })
		})

		it("leaves out somebody who scored nothing", async () => {
			await answer(ALICE, manila(2026, 9, 1), 10)
			await answer(BOB, manila(2026, 9, 1), 0)

			await service.rebuild("weekly", manila(2026, 9, 3))

			// A board place for nought points is not a place anybody earned.
			const rows = await db.select().from(leaderboardEntries)
			expect(rows.map(row => row.accountId)).toEqual([ALICE])
		})

		it("is idempotent: running it again does not double anybody", async () => {
			await seedWeek()

			await service.rebuild("weekly", manila(2026, 9, 3))
			await service.rebuild("weekly", manila(2026, 9, 3))

			const rows = await db.select().from(leaderboardEntries)
			expect(rows).toHaveLength(3)
			expect(rows.find(row => row.accountId === ALICE)?.score).toBe(30)
		})

		it("picks up a late upload on the next run", async () => {
			await seedWeek()
			await service.rebuild("weekly", manila(2026, 9, 3))

			await answer(BOB, manila(2026, 9, 2), 100)
			await service.rebuild("weekly", manila(2026, 9, 3))

			const [bob] = await db
				.select()
				.from(leaderboardEntries)
				.where(eq(leaderboardEntries.accountId, BOB))
			expect(bob).toMatchObject({ score: 125, rank: 1 })
		})
	})

	describe("AC4 — rank movement against the previous period", () => {
		it("records how many places somebody gained or lost", async () => {
			// Last week: Bob first, Alice second.
			await answer(BOB, manila(2026, 8, 25), 50)
			await answer(ALICE, manila(2026, 8, 25), 10)
			await service.rebuild("weekly", manila(2026, 8, 25))

			// This week: Alice first, Bob second.
			await answer(ALICE, manila(2026, 9, 1), 90)
			await answer(BOB, manila(2026, 9, 1), 20)
			await service.rebuild("weekly", manila(2026, 9, 1))

			const rows = await db
				.select()
				.from(leaderboardEntries)
				.where(eq(leaderboardEntries.periodStart, "2026-08-31"))
			expect(
				rows.map(row => [row.accountId, row.rank, row.rankMovement]).sort()
			).toEqual([
				[ALICE, 1, 1],
				[BOB, 2, -1],
			])
		})

		it("reports no movement at all for somebody with no previous period", async () => {
			await answer(ALICE, manila(2026, 9, 1), 10)

			await service.rebuild("weekly", manila(2026, 9, 1))

			// Null, not zero: nobody to compare with is not "held station".
			const [alice] = await db.select().from(leaderboardEntries)
			expect(alice?.rankMovement).toBeNull()
		})
	})

	describe("AC3 / AC5 — the flag, and what is shown", () => {
		it("refuses outright when the leaderboard is switched off", async () => {
			await db.execute(sql`delete from module_configuration`)

			// A disabled feature that still answered would be a feature, and the
			// flag would be decoration.
			await expect(service.forAccount(ALICE, "weekly")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
		})

		it("shows an alias and never a name or an address", async () => {
			await answer(ALICE, manila(2026, 9, 1), 10)
			await service.rebuild("weekly", manila(2026, 9, 1))

			const board = await service.forAccount(ALICE, "weekly")

			const shown = JSON.stringify(board)
			expect(shown).not.toContain("@example.test")
			expect(shown).not.toContain("GM-4 gm4-alice")
			expect(board.top[0]?.alias).toBe(generatedAlias(ALICE))
		})

		it("keeps a generated alias stable across periods", () => {
			// A board where the same person appeared under a different name each
			// week would be unreadable.
			expect(generatedAlias(ALICE)).toBe(generatedAlias(ALICE))
			expect(generatedAlias(ALICE)).not.toBe(generatedAlias(BOB))
		})

		it("shows the chosen alias once somebody has one", async () => {
			await answer(ALICE, manila(2026, 9, 1), 10)
			await service.rebuild("weekly", manila(2026, 9, 1))
			await db.insert(pisoCampRegions).values({
				code: "1300000000",
				name: "NCR",
				catalogVersion: "PSGC-2Q-2026",
			})
			await db.insert(pisoCampCities).values({
				code: "1380100000",
				regionCode: "1300000000",
				name: "Manila",
				catalogVersion: "PSGC-2Q-2026",
			})
			// F3 ties a profile to the consent that registered it, so the fixture
			// needs one before the profile it belongs to.
			await db.execute(sql`
				insert into privacy_notice
					(id, version, title, body, source_url, content_sha256, effective_at)
				values ('7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f', 'gm4-notice', 'Notice', 'Body',
					'https://www.bsp.gov.ph/privacy', ${"d".repeat(64)}, now())
			`)
			await db.execute(sql`
				insert into consent_record
					(id, account_id, purpose, notice_id, notice_version, status, responded_at)
				values ('9f8e7d6c-5b4a-4302-9182-736455647382', ${ALICE}, 'registration',
					'7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f', 'gm4-notice', 'granted', now())
			`)
			await db.insert(pisoCampProfiles).values({
				accountId: ALICE,
				gender: "female",
				age: 30,
				regionCode: "1300000000",
				cityCode: "1380100000",
				registrationConsentRecordId: "9f8e7d6c-5b4a-4302-9182-736455647382",
				leaderboardAlias: "Piso Champion",
			})

			const board = await service.forAccount(ALICE, "weekly")

			expect(board.top[0]?.alias).toBe("Piso Champion")
		})

		it("tells somebody where they stand even outside the top", async () => {
			await answer(ALICE, manila(2026, 9, 1), 10)
			await service.rebuild("weekly", manila(2026, 9, 1))

			const board = await service.forAccount(ALICE, "weekly")

			// A board that only shows the leaders tells everybody else nothing
			// about themselves.
			expect(board.you).toMatchObject({ rank: 1, score: 10 })
		})

		it("says plainly that somebody has not scored this period", async () => {
			await answer(ALICE, manila(2026, 9, 1), 10)
			await service.rebuild("weekly", manila(2026, 9, 1))

			const board = await service.forAccount(BOB, "weekly")

			expect(board.you).toBeNull()
			expect(board.top).toHaveLength(1)
		})
	})
})
