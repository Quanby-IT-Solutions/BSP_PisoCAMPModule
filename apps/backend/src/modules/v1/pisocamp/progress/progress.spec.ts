import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { analyticsEvents, triviaResponses, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampProgressService } from "./progress.service"

const ALICE = "gm5-alice"
const BOB = "gm5-bob"
const ALICE_DEVICE = "GmFiveAliceDevice00001"
const BOB_DEVICE = "GmFiveBobDeviceId00002"

function at(day: number, hour = 10) {
	return new Date(Date.UTC(2026, 8, day, hour - 8))
}

/**
 * GM-5. Every figure is one person's own activity, reconciled against the rows
 * that produced it — and checked not to include anybody else's.
 */
describe("GM-5 progress", () => {
	const service = new PisoCampProgressService()

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table trivia_response, analytics_event, piso_camp_device_account_link,
			sessions, accounts, users restart identity cascade
		`)
		await db.execute(sql`truncate table consent_record restart identity cascade`)
		await db.execute(sql`truncate table privacy_notice restart identity cascade`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[ALICE, BOB].map(id => ({
				id,
				name: `GM-5 ${id}`,
				email: `${id}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		// F3 ties a link to the consent that registered the device, so the
		// fixture needs the notice and the consent behind it.
		await db.execute(sql`
			insert into privacy_notice
				(id, version, title, body, source_url, content_sha256, effective_at)
			values ('2b3c4d5e-6f70-4812-9345-67890abcdef0', 'gm5-notice', 'Notice', 'Body',
				'https://www.bsp.gov.ph/privacy', ${"e".repeat(64)}, now())
		`)
		await db.execute(sql`
			insert into consent_record
				(id, account_id, purpose, notice_id, notice_version, status, responded_at)
			values
				('3c4d5e6f-7081-4923-a456-7890abcdef01', ${ALICE}, 'registration',
					'2b3c4d5e-6f70-4812-9345-67890abcdef0', 'gm5-notice', 'granted', now()),
				('4d5e6f70-8192-4a34-b567-890abcdef012', ${BOB}, 'registration',
					'2b3c4d5e-6f70-4812-9345-67890abcdef0', 'gm5-notice', 'granted', now())
		`)
		await db.execute(sql`
			insert into piso_camp_device_account_link
				(device_pseudo_id, account_id, registration_consent_record_id)
			values
				(${ALICE_DEVICE}, ${ALICE}, '3c4d5e6f-7081-4923-a456-7890abcdef01'),
				(${BOB_DEVICE}, ${BOB}, '4d5e6f70-8192-4a34-b567-890abcdef012')
		`)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function answered(
		accountId: string,
		options: {
			contentItemId?: string
			correct?: boolean
			skipped?: boolean
			points?: number
			when?: Date
		} = {}
	) {
		const skipped = options.skipped ?? false
		const correct = options.correct ?? false
		await db.insert(triviaResponses).values({
			responseId: randomUUID(),
			accountId,
			contentItemId: options.contentItemId ?? randomUUID(),
			contentVersionId: randomUUID(),
			category: "banknotes",
			difficulty: "easy",
			correct,
			skipped,
			linkOpened: false,
			points: options.points ?? (correct ? 10 : 0),
			answeredAt: options.when ?? at(1),
		})
	}

	async function viewed(devicePseudoId: string, logicalId: string, when = at(1)) {
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: "content_view",
			occurredAt: when,
			subjectPseudoId: devicePseudoId,
			sessionId: randomUUID(),
			accountType: "registered",
			screen: "currency_detail",
			feature: "currency_education",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "online",
			status: "completed",
			properties: { logicalId } as never,
		})
	}

	describe("AC1 — the summary reconciles with what was done", () => {
		it("counts topics, answers, accuracy, points and the last activity", async () => {
			const topic = randomUUID()
			await answered(ALICE, { contentItemId: topic, correct: true, points: 10 })
			await answered(ALICE, { contentItemId: topic, correct: false })
			await answered(ALICE, { correct: true, points: 20, when: at(3) })
			await answered(ALICE, { skipped: true })
			await viewed(ALICE_DEVICE, "content.one")
			await viewed(ALICE_DEVICE, "content.one")
			await viewed(ALICE_DEVICE, "content.two", at(2))

			const progress = await service.forAccount(ALICE)

			expect(progress).toMatchObject({
				// Two distinct items viewed, though one was opened twice.
				topicsViewed: 2,
				// Three distinct items were put to them: the repeated one counts
				// once, and the skipped one is still an item they were shown.
				topicsAnswered: 3,
				questionsAnswered: 3,
				questionsCorrect: 2,
				questionsSkipped: 1,
				// Two right out of three answered, and the skip is not one of them.
				accuracyPercent: 66.67,
				points: 30,
			})
			expect(progress.lastActivityAt).toBe(at(3).toISOString())
		})

		it("keeps a skipped question out of the accuracy denominator", async () => {
			await answered(ALICE, { correct: true, points: 10 })
			await answered(ALICE, { skipped: true })

			const progress = await service.forAccount(ALICE)

			// Skipping is not failing, and counting it as a wrong answer would
			// tell somebody they are worse at this than they are.
			expect(progress.accuracyPercent).toBe(100)
			expect(progress.questionsSkipped).toBe(1)
		})

		it("counts nobody else's activity", async () => {
			await answered(BOB, { correct: true, points: 50 })
			await viewed(BOB_DEVICE, "content.three")
			await answered(ALICE, { correct: true, points: 10 })

			const progress = await service.forAccount(ALICE)

			expect(progress).toMatchObject({ points: 10, topicsViewed: 0 })
		})

		it("takes the later of an answer and a view as the last activity", async () => {
			await answered(ALICE, { correct: true, points: 10, when: at(1) })
			await viewed(ALICE_DEVICE, "content.one", at(5))

			const progress = await service.forAccount(ALICE)

			expect(progress.lastActivityAt).toBe(at(5).toISOString())
		})
	})

	describe("AC2 — no activity is zeros, not an error", () => {
		it("answers with zeros and no last activity", async () => {
			const progress = await service.forAccount(ALICE)

			expect(progress).toEqual({
				topicsViewed: 0,
				topicsAnswered: 0,
				questionsAnswered: 0,
				questionsCorrect: 0,
				questionsSkipped: 0,
				accuracyPercent: 0,
				points: 0,
				// Null rather than a date: nothing has happened yet, and a
				// fabricated timestamp would say something did.
				lastActivityAt: null,
			})
		})

		it("answers for an account that has never been linked to a device", async () => {
			await db.execute(sql`delete from piso_camp_device_account_link`)
			await answered(ALICE, { correct: true, points: 10 })

			const progress = await service.forAccount(ALICE)

			// The answers are still theirs; only the views need the link.
			expect(progress).toMatchObject({ points: 10, topicsViewed: 0 })
		})
	})
})
