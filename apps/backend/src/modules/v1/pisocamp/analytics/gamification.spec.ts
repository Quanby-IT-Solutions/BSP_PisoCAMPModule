import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { analyticsEvents, leaderboardEntries, triviaResponses, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { GamificationService } from "./gamification.service"

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

const ADMIN_ID = "an5-admin"
const ALICE = "an5-alice"
const BOB = "an5-bob"
const CARA = "an5-cara"
const DAN = "an5-dan"

const ALICE_DEVICE = "AnFiveAliceDevice00001"

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour = 10, minute = 0) {
	return new Date(Date.UTC(2026, 8, day, hour - 8, minute))
}

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

/**
 * AN-5. Reconciled against `trivia_response` and `leaderboard_entry` as the
 * definition of done requires: a person's answers are what they actually did,
 * and the events are only how it was reported.
 */
describe("AN-5 gamification and trivia metrics", () => {
	let service: GamificationService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table leaderboard_entry, trivia_response, analytics_event,
			module_configuration, audit_log, sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[ADMIN_ID, ALICE, BOB, CARA, DAN].map(id => ({
				id,
				name: `AN-5 ${id}`,
				email: `${id}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		service = new GamificationService(new PisoCampAdminConfigService(new AuditService()))
	})

	afterAll(async () => {
		await db.$client.end()
	})

	/** Ten more accounts, so a "top 10%" is one person rather than a rounding. */
	async function seedBoardOfTen() {
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			Array.from({ length: 10 }, (_value, index) => ({
				id: `an5-p${index}`,
				name: `AN-5 player ${index}`,
				email: `an5-p${index}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
	}

	async function entry(
		accountId: string,
		periodStart: string,
		rank: number,
		rankMovement: number | null,
		score = 10
	) {
		await db.insert(leaderboardEntries).values({
			periodType: "weekly",
			periodStart,
			accountId,
			score,
			rank,
			rankMovement,
		})
	}

	async function answered(
		accountId: string,
		when: Date,
		options: { correct?: boolean; skipped?: boolean } = {}
	) {
		const skipped = options.skipped ?? false
		const correct = options.correct ?? false
		await db.insert(triviaResponses).values({
			responseId: randomUUID(),
			accountId,
			contentItemId: randomUUID(),
			contentVersionId: randomUUID(),
			category: "banknotes",
			difficulty: "easy",
			correct,
			skipped,
			linkOpened: false,
			points: correct ? 10 : 0,
			answeredAt: when,
		})
	}

	async function event(
		name: "trivia_prompt_shown" | "content_view" | "link_open" | "account_prompt_shown",
		when: Date,
		sessionId: string
	) {
		const shapes = {
			trivia_prompt_shown: {
				// The catalog pins each event to its screen and feature.
				screen: "trivia_prompt",
				feature: "trivia",
				properties: { logicalId: "content.one" },
			},
			content_view: {
				screen: "currency_detail",
				feature: "currency_education",
				properties: { logicalId: "content.one" },
			},
			link_open: {
				screen: "currency_detail",
				feature: "currency_education",
				properties: { linkType: "internal", logicalId: "content.one" },
			},
			account_prompt_shown: {
				screen: "pisocamp_home",
				feature: "account_prompt",
				properties: {},
			},
		} as const
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: name,
			occurredAt: when,
			subjectPseudoId: ALICE_DEVICE,
			sessionId,
			accountType: "registered",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "online",
			status: "completed",
			...shapes[name],
			properties: shapes[name].properties as never,
		})
	}

	describe("AC1 — participation and rank movement", () => {
		it("divides the players by everybody who could have played", async () => {
			await entry(ALICE, "2026-09-07", 1, 2)
			await entry(BOB, "2026-09-07", 2, -1)
			await entry(CARA, "2026-09-07", 3, 0)
			await entry(DAN, "2026-09-07", 4, null)

			const summary = await service.summary(RANGE)

			// Five accounts exist; four are on the board.
			expect(summary.participation).toMatchObject({
				eligibleUsers: 5,
				participatingUsers: 4,
				participationRatePercent: 80,
				movedUp: 1,
				movedDown: 1,
				unchanged: 1,
				newEntrants: 1,
			})
		})

		it("reports zero rather than dividing by an empty board", async () => {
			const summary = await service.summary(RANGE)

			expect(summary.participation).toMatchObject({
				participatingUsers: 0,
				participationRatePercent: 0,
			})
		})
	})

	describe("AC2 — retention of the configured top group", () => {
		it("counts how many of the previous top are still in it", async () => {
			await seedBoardOfTen()
			// Ten on the board each week; the top 10% is one person.
			for (let index = 0; index < 10; index += 1) {
				await entry(`an5-p${index}`, "2026-09-07", index + 1, null)
				await entry(`an5-p${index}`, "2026-09-14", index + 1, 0)
			}

			const summary = await service.summary(RANGE)

			expect(summary.topPerformers).toMatchObject({
				topGroupPercent: 10,
				previousTopUsers: 1,
				retainedTopUsers: 1,
				retentionRatePercent: 100,
			})
		})

		it("notices when the top group turns over", async () => {
			await seedBoardOfTen()
			for (let index = 0; index < 10; index += 1) {
				await entry(`an5-p${index}`, "2026-09-07", index + 1, null)
				// The order reverses, so last week's leader is now last.
				await entry(`an5-p${index}`, "2026-09-14", 10 - index, 0)
			}

			const summary = await service.summary(RANGE)

			expect(summary.topPerformers).toMatchObject({
				previousTopUsers: 1,
				retainedTopUsers: 0,
				retentionRatePercent: 0,
			})
		})

		it("honours a different configured top group", async () => {
			await db.execute(sql`
				insert into module_configuration (key, value, updated_by)
				values ('leaderboard_top_group_percent', '50'::jsonb, ${ADMIN_ID})
			`)
			await seedBoardOfTen()
			for (let index = 0; index < 10; index += 1) {
				await entry(`an5-p${index}`, "2026-09-07", index + 1, null)
				await entry(`an5-p${index}`, "2026-09-14", index + 1, 0)
			}

			const summary = await service.summary(RANGE)

			// Half of ten, which is the setting doing its job.
			expect(summary.topPerformers).toMatchObject({
				topGroupPercent: 50,
				previousTopUsers: 5,
				retainedTopUsers: 5,
			})
		})
	})

	describe("AC3 — trivia participation, reconciled with the responses", () => {
		it("counts shown, answered, skipped, correct and incorrect", async () => {
			const session = randomUUID()
			await event("trivia_prompt_shown", manila(2, 9), session)
			await event("trivia_prompt_shown", manila(2, 10), session)
			await event("trivia_prompt_shown", manila(2, 11), session)
			await event("trivia_prompt_shown", manila(2, 12), session)
			await answered(ALICE, manila(2, 9, 30), { correct: true })
			await answered(ALICE, manila(2, 10, 30), { correct: false })
			await answered(BOB, manila(2, 11, 30), { correct: true })
			await answered(BOB, manila(2, 12, 30), { skipped: true })

			const summary = await service.summary(RANGE)

			expect(summary.trivia).toMatchObject({
				promptsShown: 4,
				answered: 3,
				skipped: 1,
				correct: 2,
				incorrect: 1,
				// Three answered of four shown.
				completionRatePercent: 75,
				// Two right of three answered; the skip is not a wrong answer.
				accuracyPercent: 66.67,
			})
		})

		it("counts a repeat participant as somebody who came back another day", async () => {
			await answered(ALICE, manila(2), { correct: true })
			await answered(ALICE, manila(2, 14), { correct: true })
			await answered(ALICE, manila(5), { correct: true })
			await answered(BOB, manila(2), { correct: true })
			await answered(BOB, manila(2, 15), { correct: true })

			const summary = await service.summary(RANGE)

			// Alice answered on two days; Bob answered twice on one, which is not
			// coming back.
			expect(summary.trivia).toMatchObject({
				participants: 2,
				repeatParticipants: 1,
				repeatRatePercent: 50,
			})
		})

		it("leaves out answers from outside the range", async () => {
			await answered(ALICE, manila(2), { correct: true })
			await answered(BOB, new Date(Date.UTC(2026, 9, 5)), { correct: true })

			const summary = await service.summary(RANGE)

			expect(summary.trivia).toMatchObject({ answered: 1, participants: 1 })
		})
	})

	describe("AC4 — re-engagement in learning after trivia", () => {
		it("counts only what happened after the trivia in the same session", async () => {
			const engaged = randomUUID()
			await event("content_view", manila(3, 9), engaged)
			await event("trivia_prompt_shown", manila(3, 10), engaged)
			await event("content_view", manila(3, 11), engaged)
			await event("link_open", manila(3, 12), engaged)

			const ignored = randomUUID()
			await event("trivia_prompt_shown", manila(3, 10), ignored)
			// A prompt is something the app did, not a return to the content, so
			// this session still counts as one that did not come back.
			await event("account_prompt_shown", manila(3, 11), ignored)

			const summary = await service.summary(RANGE)

			expect(summary.reengagement).toMatchObject({
				sessionsWithTrivia: 2,
				sessionsReturningToContent: 1,
				reengagementRatePercent: 50,
				// The view before the trivia is not a return: something that
				// happened first cannot have been caused by it.
				contentViewsAfterTrivia: 1,
				relatedLinkOpensAfterTrivia: 1,
				engagementPromptsAfterTrivia: 1,
			})
		})

		it("reports zero when no trivia was shown at all", async () => {
			const summary = await service.summary(RANGE)

			expect(summary.reengagement).toMatchObject({
				sessionsWithTrivia: 0,
				reengagementRatePercent: 0,
			})
		})
	})

	it("says whether the leaderboard is switched on at all", async () => {
		await expect(service.summary(RANGE)).resolves.toMatchObject({
			leaderboardEnabled: false,
		})

		await db.execute(sql`
			insert into module_configuration (key, value, updated_by)
			values ('leaderboard_enabled', 'true'::jsonb, ${ADMIN_ID})
		`)

		// A participation rate of zero means something different when the board
		// is switched off, and the reader needs to be told which it is.
		await expect(service.summary(RANGE)).resolves.toMatchObject({
			leaderboardEnabled: true,
		})
	})
})
