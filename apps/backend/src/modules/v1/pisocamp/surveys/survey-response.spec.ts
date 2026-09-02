import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import { consentRecords, surveyAnswers, surveyQuestions, surveyResponses } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"
import { SurveyResponseService } from "./survey-response.service"

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

const EDITOR_ID = "ev2-editor"
const APPROVER_ID = "ev2-approver"
const DEVICE = "Ev2GuestDevicePseudo01"
const OTHER_DEVICE = "Ev2OtherDevicePseudo01"
const NOTICE_ID = "6f6e2b1a-6f4c-4a2e-9d54-0a3b7a2c9e11"
const NOTICE_VERSION = "ev2-notice-1"

const rating = {
	kind: "rating" as const,
	prompt: "How clear was this topic?",
	required: true,
	lowLabel: "Not clear at all",
	highLabel: "Very clear",
}
const nps = {
	kind: "nps" as const,
	prompt: "How likely are you to recommend Piso CAMP?",
	required: true,
	lowLabel: "Not at all likely",
	highLabel: "Extremely likely",
}
const text = { kind: "text" as const, prompt: "What would you change?", required: false }

function correlation(itemId: string, expectedVersionNo: number, comments?: string) {
	return {
		itemId,
		requestId: randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	} as never
}

/**
 * EV-2. The pop-up and the queue live on the device; what the server owes is a
 * store that refuses an answer without a grant and counts a re-sent one once.
 */
describe("EV-2 survey responses", () => {
	let service: SurveyResponseService
	let content: ContentService
	let workflow: ContentWorkflowService
	let surveyItemId: string
	let surveyVersionId: string
	let questionIds: { rating: string; nps: string; text: string }
	let grantedConsentId: string

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table survey_answer, survey_response, content_bundle_rebuild_request,
				version_asset, asset, asset_object, survey_question, survey_detail,
				trivia_question_detail, related_link, content_version, content_item,
				consent_record, privacy_notice, piso_camp_device_account_link, audit_log,
				idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'EV2 Editor', 'ev2-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'EV2 Approver', 'ev2-approver@example.test', true, now(), now())
		`)
		await db.execute(sql`
			insert into privacy_notice (id, version, title, body, source_url, content_sha256, effective_at)
			values (${NOTICE_ID}, ${NOTICE_VERSION}, 'EV2 notice', 'Body copy for the EV-2 fixture.',
			        'https://www.bsp.gov.ph/privacy', repeat('a', 64), now())
		`)

		const audit = new AuditService()
		content = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
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
					questions: [rating, nps, text],
				},
				relatedLinks: [],
			},
			EDITOR_ID
		)
		await workflow.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(created.id, 2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(created.id, 3), APPROVER_ID)

		surveyItemId = created.id
		const published = await content.get(created.id)
		surveyVersionId = published.currentVersion.id
		const rows = await db
			.select()
			.from(surveyQuestions)
			.where(eq(surveyQuestions.contentVersionId, surveyVersionId))
			.orderBy(surveyQuestions.position)
		questionIds = { rating: rows[0]!.id, nps: rows[1]!.id, text: rows[2]!.id }
	})

	beforeEach(async () => {
		service = new SurveyResponseService()
		// Truncate, not delete: F4 makes consent evidence append-only, and the
		// trigger that enforces it is exactly the thing this suite relies on.
		await db.execute(sql`
			truncate table survey_answer, survey_response, consent_record restart identity cascade
		`)
		grantedConsentId = await insertConsent({ status: "granted", purpose: "survey" })
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function insertConsent(options: {
		status: "granted" | "declined" | "withdrawn"
		purpose: "survey" | "registration"
		devicePseudoId?: string
	}) {
		const id = randomUUID()
		await db.insert(consentRecords).values({
			id,
			devicePseudoId: options.devicePseudoId ?? DEVICE,
			purpose: options.purpose,
			noticeId: NOTICE_ID,
			noticeVersion: NOTICE_VERSION,
			status: options.status,
			respondedAt: new Date("2026-09-02T03:00:00.000Z"),
		})
		return id
	}

	function response(overrides: Partial<Record<string, unknown>> = {}) {
		return {
			responseId: "7c1f9a2e-3b4d-4e5f-8a6b-9c0d1e2f3a4b",
			contentItemId: surveyItemId,
			contentVersionId: surveyVersionId,
			consentRecordId: grantedConsentId,
			submittedAt: "2026-09-02T04:05:06.000Z",
			answers: [
				{ kind: "scale", questionId: questionIds.rating, value: 4 },
				{ kind: "scale", questionId: questionIds.nps, value: 9 },
				{ kind: "text", questionId: questionIds.text, value: "Nothing, it was clear." },
			],
			...overrides,
		} as never
	}

	const guest = { devicePseudoId: DEVICE } as const

	describe("AC3 — a consented submission is stored with its grant and version", () => {
		it("stores the response, its consent reference and every answer", async () => {
			const acknowledgement = await service.ingest(guest, { responses: [response()] } as never)

			expect(acknowledgement.ackedResponseIds).toEqual([
				"7c1f9a2e-3b4d-4e5f-8a6b-9c0d1e2f3a4b",
			])
			const [stored] = await db.select().from(surveyResponses)
			expect(stored).toMatchObject({
				contentItemId: surveyItemId,
				contentVersionId: surveyVersionId,
				consentRecordId: grantedConsentId,
				devicePseudoId: DEVICE,
				accountId: null,
				submittedAt: new Date("2026-09-02T04:05:06.000Z"),
			})
			const answers = await db.select().from(surveyAnswers)
			expect(answers).toHaveLength(3)
			expect(answers.find(row => row.questionId === questionIds.rating)).toMatchObject({
				scaleValue: 4,
				textValue: null,
				skipped: false,
			})
			expect(answers.find(row => row.questionId === questionIds.text)).toMatchObject({
				scaleValue: null,
				textValue: "Nothing, it was clear.",
			})
		})

		it("accepts a skipped optional question and refuses a skipped required one", async () => {
			await service.ingest(guest, {
				responses: [
					response({
						answers: [
							{ kind: "scale", questionId: questionIds.rating, value: 1 },
							{ kind: "scale", questionId: questionIds.nps, value: 0 },
							{ kind: "skipped", questionId: questionIds.text },
						],
					}),
				],
			} as never)
			expect(await db.select().from(surveyResponses)).toHaveLength(1)

			await expect(
				service.ingest(guest, {
					responses: [
						response({
							responseId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
							answers: [
								{ kind: "skipped", questionId: questionIds.rating },
								{ kind: "scale", questionId: questionIds.nps, value: 5 },
								{ kind: "skipped", questionId: questionIds.text },
							],
						}),
					],
				} as never)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(await db.select().from(surveyResponses)).toHaveLength(1)
		})
	})

	describe("AC2 / the consent-negative case", () => {
		it("refuses a response whose grant was declined", async () => {
			const declined = await insertConsent({ status: "declined", purpose: "survey" })

			await expect(
				service.ingest(guest, {
					responses: [response({ consentRecordId: declined })],
				} as never)
			).rejects.toMatchObject({ code: "FORBIDDEN" })

			// Nothing collected. That is the whole point of the criterion.
			expect(await db.select().from(surveyResponses)).toHaveLength(0)
			expect(await db.select().from(surveyAnswers)).toHaveLength(0)
		})

		it("refuses a withdrawn grant and a grant for another purpose", async () => {
			const withdrawn = await insertConsent({ status: "withdrawn", purpose: "survey" })
			const registration = await insertConsent({ status: "granted", purpose: "registration" })

			for (const consentRecordId of [withdrawn, registration]) {
				await expect(
					service.ingest(guest, { responses: [response({ consentRecordId })] } as never)
				).rejects.toMatchObject({ code: "FORBIDDEN" })
			}
			expect(await db.select().from(surveyResponses)).toHaveLength(0)
		})

		it("refuses somebody else's grant", async () => {
			const other = await insertConsent({
				status: "granted",
				purpose: "survey",
				devicePseudoId: OTHER_DEVICE,
			})

			await expect(
				service.ingest(guest, { responses: [response({ consentRecordId: other })] } as never)
			).rejects.toMatchObject({ code: "FORBIDDEN" })
			expect(await db.select().from(surveyResponses)).toHaveLength(0)
		})

		it("refuses a grant that does not exist", async () => {
			await expect(
				service.ingest(guest, {
					responses: [response({ consentRecordId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" })],
				} as never)
			).rejects.toMatchObject({ code: "FORBIDDEN" })
		})
	})

	describe("AC4 — an offline response uploads once", () => {
		it("replays a batch with the same acknowledgement and no duplicate rows", async () => {
			const input = { responses: [response()] } as never

			const first = await service.ingest(guest, input)
			const replay = await service.ingest(guest, input)

			expect(replay).toEqual(first)
			expect(await db.select().from(surveyResponses)).toHaveLength(1)
			expect(await db.select().from(surveyAnswers)).toHaveLength(3)
		})

		it("keeps the stored answers when a response id is replayed with different ones", async () => {
			await service.ingest(guest, { responses: [response()] } as never)

			await service.ingest(guest, {
				responses: [
					response({
						answers: [
							{ kind: "scale", questionId: questionIds.rating, value: 1 },
							{ kind: "scale", questionId: questionIds.nps, value: 1 },
							{ kind: "skipped", questionId: questionIds.text },
						],
					}),
				],
			} as never)

			const answers = await db.select().from(surveyAnswers)
			expect(answers.find(row => row.questionId === questionIds.rating)?.scaleValue).toBe(4)
		})

		it("refuses a response id already held by another subject", async () => {
			await service.ingest(guest, { responses: [response()] } as never)
			const other = await insertConsent({
				status: "granted",
				purpose: "survey",
				devicePseudoId: OTHER_DEVICE,
			})

			await expect(
				service.ingest({ devicePseudoId: OTHER_DEVICE }, {
					responses: [response({ consentRecordId: other })],
				} as never)
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(await db.select().from(surveyResponses)).toHaveLength(1)
		})
	})

	describe("an answer has to fit the question it answers", () => {
		async function refuses(answers: unknown[]) {
			await expect(
				service.ingest(guest, { responses: [response({ answers })] } as never)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(await db.select().from(surveyResponses)).toHaveLength(0)
		}

		it("refuses a score on a written question", async () => {
			await refuses([
				{ kind: "scale", questionId: questionIds.rating, value: 4 },
				{ kind: "scale", questionId: questionIds.nps, value: 9 },
				{ kind: "scale", questionId: questionIds.text, value: 3 },
			])
		})

		it("refuses words on a rating", async () => {
			await refuses([
				{ kind: "text", questionId: questionIds.rating, value: "Very clear" },
				{ kind: "scale", questionId: questionIds.nps, value: 9 },
				{ kind: "skipped", questionId: questionIds.text },
			])
		})

		it("refuses a rating scored beyond five", async () => {
			// The bounds are the question's own: 8 is a fine NPS and not a rating.
			await refuses([
				{ kind: "scale", questionId: questionIds.rating, value: 8 },
				{ kind: "scale", questionId: questionIds.nps, value: 9 },
				{ kind: "skipped", questionId: questionIds.text },
			])
		})

		it("refuses a question the version does not ask", async () => {
			await refuses([
				{ kind: "scale", questionId: questionIds.rating, value: 4 },
				{ kind: "scale", questionId: questionIds.nps, value: 9 },
				{ kind: "scale", questionId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61", value: 3 },
			])
		})

		it("refuses a survey left half answered", async () => {
			await refuses([{ kind: "scale", questionId: questionIds.rating, value: 4 }])
		})

		it("refuses a response that does not name a survey", async () => {
			const advisory = await content.create(
				{
					requestId: randomUUID(),
					content: {
						contentType: "advisory",
						title: "Not a survey",
						summary: "An advisory.",
						body: "Nothing to answer here.",
					},
					relatedLinks: [],
				},
				EDITOR_ID
			)

			await expect(
				service.ingest(guest, {
					responses: [response({ contentItemId: advisory.id })],
				} as never)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
		})
	})

	describe("the database refuses an impossible answer", () => {
		it("rejects an answer that is both skipped and scored", async () => {
			await service.ingest(guest, { responses: [response()] } as never)
			const [answer] = await db.select().from(surveyAnswers)

			await expect(
				db.update(surveyAnswers).set({ skipped: true }).where(eq(surveyAnswers.id, answer!.id))
			).rejects.toMatchObject({ cause: { constraint: "survey_answer_shape_check" } })
		})

		it("rejects a second answer to the same question", async () => {
			await service.ingest(guest, { responses: [response()] } as never)

			await expect(
				db.insert(surveyAnswers).values({
					responseId: "7c1f9a2e-3b4d-4e5f-8a6b-9c0d1e2f3a4b",
					questionId: questionIds.rating,
					scaleValue: 1,
					skipped: false,
				})
			).rejects.toMatchObject({
				cause: { constraint: "survey_answer_response_question_unique" },
			})
		})

		it("rejects a response with no consent record at all", async () => {
			await expect(
				db.execute(sql`
					insert into survey_response (response_id, content_item_id, content_version_id,
						consent_record_id, device_pseudo_id, submitted_at)
					values (gen_random_uuid(), ${surveyItemId}, ${surveyVersionId},
						'9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', ${DEVICE}, now())
				`)
			).rejects.toThrow()
		})
	})
})
