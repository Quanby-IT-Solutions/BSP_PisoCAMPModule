import { eq, inArray, sql } from "drizzle-orm"

import { pisoCampAccountState, triviaResponses, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { TriviaService } from "./trivia.service"

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

const ACTIVE_ID = "gm3-active-account"
const SECOND_ID = "gm3-second-account"
const DEACTIVATED_ID = "gm3-deactivated-account"
const FIXTURE_IDS = [ACTIVE_ID, SECOND_ID, DEACTIVATED_ID]

const ITEM_ID = "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61"
const VERSION_ID = "0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74"

function response(overrides: Record<string, unknown> = {}) {
	return {
		responseId: "8e2a4a6c-6d0b-4a1a-9d1e-7a4f1b2c3d4e",
		contentItemId: ITEM_ID,
		contentVersionId: VERSION_ID,
		category: "security-features",
		difficulty: "easy" as const,
		correct: true,
		skipped: false,
		linkOpened: false,
		points: 1,
		answeredAt: "2026-09-02T04:05:06.000Z",
		...overrides,
	}
}

const skipped = response({
	responseId: "1c9a7e2b-4f5d-4c3b-8a2e-9f0d1b2c3a4d",
	correct: false,
	skipped: true,
	points: 0,
	answeredAt: "2026-09-02T04:06:07.000Z",
})

const wrongWithLink = response({
	responseId: "5b6c7d8e-9f01-4a2b-8c3d-4e5f60718293",
	difficulty: "hard" as const,
	correct: false,
	skipped: false,
	linkOpened: true,
	points: 0,
	answeredAt: "2026-09-02T04:07:08.000Z",
})

function service() {
	return new TriviaService(db, new AccountAccessService())
}

describe("GM-3 trivia response sync", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		const now = new Date("2026-09-02T00:00:00.000Z")
		await db.delete(triviaResponses)
		// Only this suite's fixtures: sibling suites keep their own account
		// state in the same table, and they all run in one band.
		await db
			.delete(pisoCampAccountState)
			.where(inArray(pisoCampAccountState.accountId, FIXTURE_IDS))
		await db.delete(users).where(eq(users.name, "GM-3 fixture"))
		await db.insert(users).values(
			FIXTURE_IDS.map(id => ({
				id,
				name: "GM-3 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		await db.insert(pisoCampAccountState).values({
			accountId: DEACTIVATED_ID,
			status: "deactivated",
			reason: "GM-3 sync rejection fixture",
		})
	})

	beforeEach(async () => {
		await db.delete(triviaResponses)
	})

	afterAll(async () => {
		await db.delete(triviaResponses)
		await db
			.delete(pisoCampAccountState)
			.where(inArray(pisoCampAccountState.accountId, FIXTURE_IDS))
		await db.delete(users).where(eq(users.name, "GM-3 fixture"))
		await db.$client.end()
	})

	it("stores every recorded field of an answer, a skip and a wrong answer", async () => {
		const acknowledgement = await service().ingest(ACTIVE_ID, {
			responses: [response(), skipped, wrongWithLink],
		})

		expect(acknowledgement.ackedResponseIds).toEqual([
			response().responseId,
			skipped.responseId,
			wrongWithLink.responseId,
		])
		const rows = await db.select().from(triviaResponses).orderBy(triviaResponses.answeredAt)
		expect(rows).toHaveLength(3)
		expect(rows[0]).toMatchObject({
			responseId: response().responseId,
			accountId: ACTIVE_ID,
			contentItemId: ITEM_ID,
			contentVersionId: VERSION_ID,
			category: "security-features",
			difficulty: "easy",
			correct: true,
			skipped: false,
			linkOpened: false,
			points: 1,
			answeredAt: new Date("2026-09-02T04:05:06.000Z"),
		})
		expect(rows[1]).toMatchObject({ skipped: true, correct: false, points: 0 })
		expect(rows[2]).toMatchObject({ difficulty: "hard", linkOpened: true, points: 0 })
		// The server records when it received the row as well as when the guest
		// answered, so a long offline stretch stays visible rather than rewritten.
		expect(rows[0]!.receivedAt.getTime()).toBeGreaterThan(rows[0]!.answeredAt.getTime())
	})

	it("replays a batch with the same acknowledgement and no duplicate rows", async () => {
		const input = { responses: [response(), skipped] }

		const first = await service().ingest(ACTIVE_ID, input)
		const replay = await service().ingest(ACTIVE_ID, input)

		expect(replay).toEqual(first)
		expect(await db.select().from(triviaResponses)).toHaveLength(2)
	})

	it("uploads an overlapping batch without duplicating what is already held", async () => {
		// What a device does when connectivity returns mid-sync: it re-sends
		// everything it has not seen acknowledged, overlap included.
		await service().ingest(ACTIVE_ID, { responses: [response()] })

		const second = await service().ingest(ACTIVE_ID, {
			responses: [response(), skipped, wrongWithLink],
		})

		expect(second.ackedResponseIds).toHaveLength(3)
		const rows = await db.select().from(triviaResponses)
		expect(rows).toHaveLength(3)
		expect(new Set(rows.map(row => row.responseId)).size).toBe(3)
	})

	it("keeps the stored answer when a response id is replayed with different content", async () => {
		await service().ingest(ACTIVE_ID, { responses: [response()] })

		await service().ingest(ACTIVE_ID, {
			responses: [response({ correct: false, points: 0, difficulty: "hard" })],
		})

		// The row is the record of what happened, so a replay cannot rewrite an
		// answer that was already counted.
		const [row] = await db.select().from(triviaResponses)
		expect(row).toMatchObject({ correct: true, points: 1, difficulty: "easy" })
	})

	it("rejects a deactivated account and retains the device's data by acknowledging nothing", async () => {
		await expect(
			service().ingest(DEACTIVATED_ID, { responses: [response(), skipped] })
		).rejects.toMatchObject({ status: 401, message: "Account is deactivated" })

		expect(await db.select().from(triviaResponses)).toHaveLength(0)
	})

	it("accepts the same batch from an active account", async () => {
		// The other branch of the same rule, so the rejection is the account
		// state and not the batch.
		await expect(
			service().ingest(ACTIVE_ID, { responses: [response(), skipped] })
		).resolves.toEqual({
			ackedResponseIds: [response().responseId, skipped.responseId],
		})
	})

	it("refuses a response id already recorded for another account", async () => {
		await service().ingest(ACTIVE_ID, { responses: [response()] })

		await expect(
			service().ingest(SECOND_ID, { responses: [response(), skipped] })
		).rejects.toMatchObject({ code: "CONFLICT" })

		const rows = await db.select().from(triviaResponses)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.accountId).toBe(ACTIVE_ID)
	})

	describe("the database refuses an impossible outcome even when the contract is bypassed", () => {
		async function insertRaw(overrides: Record<string, unknown>) {
			return db.insert(triviaResponses).values({
				...response(),
				...overrides,
				accountId: ACTIVE_ID,
				answeredAt: new Date("2026-09-02T04:05:06.000Z"),
			} as never)
		}

		it("rejects a skipped question that scored", async () => {
			await expect(insertRaw({ skipped: true, correct: false, points: 1 })).rejects.toMatchObject(
				{ cause: { constraint: "trivia_response_correct_points_check" } }
			)
		})

		it("rejects a skipped question that opened a link", async () => {
			await expect(
				insertRaw({ skipped: true, correct: false, points: 0, linkOpened: true })
			).rejects.toMatchObject({ cause: { constraint: "trivia_response_outcome_check" } })
		})

		it("rejects a correct answer worth nothing", async () => {
			await expect(insertRaw({ correct: true, points: 0 })).rejects.toMatchObject({
				cause: { constraint: "trivia_response_correct_points_check" },
			})
		})

		it("rejects a correct answer that was offered a link", async () => {
			await expect(
				insertRaw({ correct: true, points: 1, linkOpened: true })
			).rejects.toMatchObject({ cause: { constraint: "trivia_response_outcome_check" } })
		})

		it("rejects an unknown difficulty", async () => {
			await expect(insertRaw({ difficulty: "impossible" })).rejects.toMatchObject({
				cause: { constraint: "trivia_response_difficulty_check" },
			})
		})

		it("rejects a response for an account that does not exist", async () => {
			await expect(
				db.execute(sql`
					insert into trivia_response (
						response_id, account_id, content_item_id, content_version_id,
						category, difficulty, correct, skipped, link_opened, points, answered_at
					) values (
						${response().responseId}, 'gm3-not-an-account', ${ITEM_ID}, ${VERSION_ID},
						'security-features', 'easy', true, false, false, 1, now()
					)
				`)
			).rejects.toThrow()
		})
	})
})
