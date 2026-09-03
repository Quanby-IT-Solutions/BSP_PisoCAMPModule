import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import {
	analyticsEvents,
	consentRecords,
	surveyAnswers,
	surveyQuestions,
	surveyResponses,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { contentLogicalId } from "../bundle/bundle-renderer"
import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"
import { SurveyMetricsService } from "./survey-metrics.service"

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

const EDITOR_ID = "an6-editor"
const APPROVER_ID = "an6-approver"
const DEVICE = "AnSixDevicePseudoId001"
const NOTICE_ID = "5c2b1a7e-9f4c-4a2e-9d54-0a3b7a2c9e21"
const NOTICE_VERSION = "an6-notice-1"

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour = 10) {
	return new Date(Date.UTC(2026, 8, day, hour - 8))
}

function correlation(itemId: string, expectedVersionNo: number, comments?: string) {
	return {
		itemId,
		requestId: randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	} as never
}

/**
 * AN-6. EV-005 asks the report to reconcile with the responses, so every figure
 * here is asserted against rows this suite wrote by hand: what somebody
 * answered is what happened, and the events are only how it was reported.
 */
describe("AN-6 evaluation, ratings and NPS metrics", () => {
	let service: SurveyMetricsService
	let itemId: string
	let versionId: string
	let questionIds: { rating: string; nps: string; text: string }

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table survey_answer, survey_response, analytics_event,
				content_bundle_rebuild_request, version_asset, asset, asset_object,
				survey_question, survey_detail, trivia_question_detail, related_link,
				content_version, content_item, consent_record, privacy_notice,
				audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'AN6 Editor', 'an6-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'AN6 Approver', 'an6-approver@example.test', true, now(), now())
		`)
		await db.execute(sql`
			insert into privacy_notice (id, version, title, body, source_url, content_sha256, effective_at)
			values (${NOTICE_ID}, ${NOTICE_VERSION}, 'AN6 notice', 'Body copy for the AN-6 fixture.',
			        'https://www.bsp.gov.ph/privacy', repeat('b', 64), now())
		`)

		const audit = new AuditService()
		const content = new ContentService(audit)
		const workflow = new ContentWorkflowService(audit)
		const created = await content.create(
			{
				requestId: randomUUID(),
				content: {
					contentType: "survey",
					title: "How did we do?",
					summary: "A short evaluation shown after a topic.",
					body: "Answering is optional and takes less than a minute.",
					purpose: "satisfaction",
					subjectContentItemId: null,
					questions: [
						{
							kind: "rating",
							prompt: "How clear was this topic?",
							required: true,
							lowLabel: "Not clear at all",
							highLabel: "Very clear",
						},
						{
							kind: "nps",
							prompt: "How likely are you to recommend Piso CAMP?",
							required: true,
							lowLabel: "Not at all likely",
							highLabel: "Extremely likely",
						},
						{ kind: "text", prompt: "What would you change?", required: false },
					],
				},
				relatedLinks: [],
			},
			EDITOR_ID
		)
		await workflow.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(created.id, 2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(created.id, 3), APPROVER_ID)

		itemId = created.id
		versionId = (await content.get(created.id)).currentVersion.id
		const rows = await db
			.select()
			.from(surveyQuestions)
			.where(eq(surveyQuestions.contentVersionId, versionId))
			.orderBy(surveyQuestions.position)
		questionIds = { rating: rows[0]!.id, nps: rows[1]!.id, text: rows[2]!.id }
	})

	beforeEach(async () => {
		// Truncate, not delete: F4 makes consent evidence append-only, and the
		// trigger that enforces it is the thing keeping it that way.
		await db.execute(sql`
			truncate table survey_answer, survey_response, consent_record, analytics_event
			restart identity cascade
		`)
		service = new SurveyMetricsService()
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function consent(status: "granted" | "withdrawn" = "granted") {
		const id = randomUUID()
		await db.insert(consentRecords).values({
			id,
			devicePseudoId: DEVICE,
			purpose: "survey",
			noticeId: NOTICE_ID,
			noticeVersion: NOTICE_VERSION,
			status,
			respondedAt: manila(1),
		})
		return id
	}

	/** One stored response, with the answers somebody actually gave. */
	async function respond(options: {
		submittedAt: Date
		rating?: number
		nps?: number
		text?: string
		skipText?: boolean
		consentStatus?: "granted" | "withdrawn"
	}) {
		const responseId = randomUUID()
		await db.insert(surveyResponses).values({
			responseId,
			contentItemId: itemId,
			contentVersionId: versionId,
			consentRecordId: await consent(options.consentStatus),
			devicePseudoId: DEVICE,
			submittedAt: options.submittedAt,
		})
		const answers = []
		if (options.rating !== undefined) {
			answers.push({ responseId, questionId: questionIds.rating, scaleValue: options.rating })
		}
		if (options.nps !== undefined) {
			answers.push({ responseId, questionId: questionIds.nps, scaleValue: options.nps })
		}
		if (options.text !== undefined) {
			answers.push({ responseId, questionId: questionIds.text, textValue: options.text })
		}
		if (options.skipText) {
			answers.push({ responseId, questionId: questionIds.text, skipped: true })
		}
		if (answers.length > 0) await db.insert(surveyAnswers).values(answers)
		return responseId
	}

	async function promptEvent(
		name: "survey_prompt_shown" | "survey_declined",
		when: Date,
		logicalId = contentLogicalId(itemId)
	) {
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: name,
			occurredAt: when,
			subjectPseudoId: DEVICE,
			sessionId: randomUUID(),
			accountType: "guest",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "online",
			screen: "survey_prompt",
			feature: "survey",
			status: "completed",
			properties: (name === "survey_declined"
				? { logicalId, purpose: "satisfaction", stage: "prompt" }
				: { logicalId, purpose: "satisfaction" }) as never,
		})
	}

	describe("AC1 — per survey and period, with NPS from the answers", () => {
		it("reports counts, completion, average, distribution and NPS", async () => {
			await respond({ submittedAt: manila(2), rating: 5, nps: 10, text: "Nothing." })
			await respond({ submittedAt: manila(3), rating: 4, nps: 8 })
			await respond({ submittedAt: manila(4), rating: 3, nps: 3, skipText: true })
			await promptEvent("survey_prompt_shown", manila(2))
			await promptEvent("survey_prompt_shown", manila(3))
			await promptEvent("survey_prompt_shown", manila(4))
			await promptEvent("survey_prompt_shown", manila(5))
			await promptEvent("survey_declined", manila(5))

			const summary = await service.summary(RANGE)

			expect(summary.surveys).toHaveLength(1)
			const survey = summary.surveys[0]!
			expect(survey).toMatchObject({
				contentItemId: itemId,
				title: "How did we do?",
				promptsShown: 4,
				declined: 1,
				responses: 3,
				// Three answered of four shown.
				completionRatePercent: 75,
				averageRating: 4,
			})

			const rating = survey.questions.find(question => question.kind === "rating")!
			expect(rating).toMatchObject({ answered: 3, skipped: 0, average: 4 })
			// Every point on the 1-5 scale, including the two nobody chose.
			expect(rating.distribution).toEqual([
				{ value: 1, responses: 0, percent: 0 },
				{ value: 2, responses: 0, percent: 0 },
				{ value: 3, responses: 1, percent: 33.33 },
				{ value: 4, responses: 1, percent: 33.33 },
				{ value: 5, responses: 1, percent: 33.33 },
			])

			const nps = survey.questions.find(question => question.kind === "nps")!
			// 10 promotes, 8 is passive, 3 detracts: 33.33% − 33.33% = 0.
			expect(nps.nps).toMatchObject({
				promoters: 1,
				passives: 1,
				detractors: 1,
				score: 0,
			})
			expect(summary.overallNps.score).toBe(0)
		})

		it("computes NPS as percent promoters minus percent detractors", async () => {
			await respond({ submittedAt: manila(2), nps: 10 })
			await respond({ submittedAt: manila(2), nps: 9 })
			await respond({ submittedAt: manila(3), nps: 8 })
			await respond({ submittedAt: manila(3), nps: 4 })

			const summary = await service.summary(RANGE)

			// 50% promoters, 25% passives, 25% detractors.
			expect(summary.overallNps).toMatchObject({
				promoters: 2,
				passives: 1,
				detractors: 1,
				promoterPercent: 50,
				detractorPercent: 25,
				score: 25,
			})
		})

		it("says nobody answered rather than reporting a score of zero", async () => {
			const summary = await service.summary(RANGE)

			// Zero would mean the promoters and the detractors cancelled out.
			expect(summary.overallNps.score).toBeNull()
			expect(summary.overallAverageRating).toBeNull()
			expect(summary.surveys).toEqual([])
		})

		it("keeps a skipped question out of the average", async () => {
			await respond({ submittedAt: manila(2), rating: 4, skipText: true })
			await respond({ submittedAt: manila(3), rating: 2 })

			const summary = await service.summary(RANGE)

			const text = summary.surveys[0]!.questions.find(
				question => question.kind === "text"
			)!
			expect(text).toMatchObject({ answered: 0, skipped: 1, average: null })
			expect(summary.surveys[0]!.averageRating).toBe(3)
		})

		it("leaves out responses submitted outside the range", async () => {
			await respond({ submittedAt: manila(2), rating: 5 })
			await respond({ submittedAt: new Date(Date.UTC(2026, 9, 2)), rating: 1 })

			const summary = await service.summary(RANGE)

			expect(summary.totalResponses).toBe(1)
			expect(summary.overallAverageRating).toBe(5)
		})
	})

	describe("AC2 — the counts match the stored responses exactly", () => {
		it("counts exactly what the tables hold", async () => {
			await respond({ submittedAt: manila(2), rating: 5, nps: 10, text: "Good." })
			await respond({ submittedAt: manila(3), rating: 4, nps: 7 })
			await respond({ submittedAt: manila(4), rating: 4, skipText: true })

			const summary = await service.summary(RANGE)

			const [stored] = await db
				.select({ count: sql<string>`count(*)::text` })
				.from(surveyResponses)
			const [answered] = await db
				.select({ count: sql<string>`count(*)::text` })
				.from(surveyAnswers)
				.where(eq(surveyAnswers.skipped, false))

			expect(summary.totalResponses).toBe(Number(stored!.count))
			expect(summary.surveys[0]!.responses).toBe(Number(stored!.count))
			const counted = summary.surveys[0]!.questions.reduce(
				(sum, question) => sum + question.answered,
				0
			)
			expect(counted).toBe(Number(answered!.count))
		})

		it("says how many of those responses rest on a withdrawn consent", async () => {
			await respond({ submittedAt: manila(2), rating: 5 })
			await respond({ submittedAt: manila(3), rating: 4, consentStatus: "withdrawn" })

			const summary = await service.summary(RANGE)

			// The response is still stored, and the report says the grant behind
			// it has since been taken back rather than quietly counting it.
			expect(summary.consent).toEqual({ granted: 1, withdrawn: 1 })
			expect(summary.surveys[0]!.consent).toEqual({ granted: 1, withdrawn: 1 })
			expect(summary.totalResponses).toBe(2)
		})

		it("ignores a prompt whose logical id names something else", async () => {
			await respond({ submittedAt: manila(2), rating: 5 })
			await promptEvent("survey_prompt_shown", manila(2))
			await promptEvent("survey_prompt_shown", manila(2), "catalog.ngc-coins.php-1")

			const summary = await service.summary(RANGE)

			expect(summary.surveys[0]!.promptsShown).toBe(1)
		})
	})

	describe("AC3 — store ratings are AN-11's, and the report says so", () => {
		it("does not present the in-app ratings as a consolidated figure", async () => {
			await respond({ submittedAt: manila(2), rating: 5 })

			const summary = await service.summary(RANGE)

			// Calling the in-app half "consolidated" would be a claim about data
			// this build has never seen.
			expect(summary.storeRatingsAvailable).toBe(false)
		})
	})
})
