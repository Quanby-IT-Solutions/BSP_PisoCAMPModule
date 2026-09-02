import { eq, sql } from "drizzle-orm"

import { surveyDetails, surveyQuestions } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { renderPublishedContentResources } from "../bundle/bundle-renderer"
import { ContentWorkflowService } from "./content-workflow.service"
import { ContentService } from "./content.service"

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

const EDITOR_ID = "ev1-editor"
const APPROVER_ID = "ev1-approver"

type SurveyQuestionInput =
	| { kind: "rating" | "nps"; prompt: string; required: boolean; lowLabel: string; highLabel: string }
	| { kind: "text"; prompt: string; required: boolean }

const ratingQuestion: SurveyQuestionInput = {
	kind: "rating",
	prompt: "How clear was this topic?",
	required: true,
	lowLabel: "Not clear at all",
	highLabel: "Very clear",
}

const npsQuestion: SurveyQuestionInput = {
	kind: "nps",
	prompt: "How likely are you to recommend Piso CAMP?",
	required: true,
	lowLabel: "Not at all likely",
	highLabel: "Extremely likely",
}

const textQuestion: SurveyQuestionInput = {
	kind: "text",
	prompt: "What would you change?",
	required: false,
}

function survey(
	title: string,
	overrides: {
		purpose?: "topic" | "satisfaction" | "feature" | "application" | "nps" | "usefulness"
		subjectContentItemId?: string | null
		questions?: SurveyQuestionInput[]
	} = {}
) {
	return {
		contentType: "survey" as const,
		title,
		summary: "A short evaluation shown after a topic.",
		body: "Answering is optional and takes less than a minute.",
		purpose: overrides.purpose ?? ("topic" as const),
		subjectContentItemId: overrides.subjectContentItemId ?? null,
		questions: overrides.questions ?? [ratingQuestion, textQuestion],
	}
}

function correlation(
	itemId: string,
	expectedVersionNo: number
): { itemId: string; requestId: string; expectedVersionNo: number }
function correlation(
	itemId: string,
	expectedVersionNo: number,
	comments: string
): { itemId: string; requestId: string; expectedVersionNo: number; comments: string }
function correlation(
	itemId: string,
	expectedVersionNo: number,
	comments?: string
): { itemId: string; requestId: string; expectedVersionNo: number; comments?: string } {
	return {
		itemId,
		requestId: crypto.randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	}
}

/**
 * EV-1. A survey is content: it uses CM-3's workflow unchanged, and this suite
 * is about what a survey adds — its purpose, its subject and its questions.
 */
describe("EV-1 surveys through the content workflow", () => {
	let contentService: ContentService
	let workflow: ContentWorkflowService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, version_asset, asset, asset_object,
				survey_question, survey_detail, trivia_question_detail, related_link,
				content_version, content_item, audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'EV1 Editor', 'ev1-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'EV1 Approver', 'ev1-approver@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, survey_question, survey_detail,
				trivia_question_detail, related_link, content_version, content_item, audit_log,
				idempotency_keys
			restart identity cascade
		`)
		const audit = new AuditService()
		contentService = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function createSurvey(...args: Parameters<typeof survey>) {
		return contentService.create(
			{ requestId: crypto.randomUUID(), content: survey(...args), relatedLinks: [] },
			EDITOR_ID
		)
	}

	async function createTopic(title: string) {
		return contentService.create(
			{
				requestId: crypto.randomUUID(),
				content: {
					contentType: "advisory",
					title,
					summary: "A topic a survey can be about.",
					body: "Something worth evaluating.",
				},
				relatedLinks: [],
			},
			EDITOR_ID
		)
	}

	async function publish(itemId: string) {
		await workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(itemId, 2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(itemId, 3), APPROVER_ID)
	}

	describe("AC1 — a survey saves as a draft with its purpose and questions", () => {
		it("keeps the purpose, the questions and their order", async () => {
			const created = await createSurvey("How did we do?", {
				purpose: "satisfaction",
				questions: [ratingQuestion, npsQuestion, textQuestion],
			})

			expect(created.status).toBe("draft")
			expect(created.currentVersion.status).toBe("draft")
			expect(created.currentVersion.content).toMatchObject({
				contentType: "survey",
				purpose: "satisfaction",
				subjectContentItemId: null,
			})
			const content = created.currentVersion.content as { questions: SurveyQuestionInput[] }
			expect(content.questions).toEqual([ratingQuestion, npsQuestion, textQuestion])
			const stored = await db
				.select()
				.from(surveyQuestions)
				.orderBy(surveyQuestions.position)
			expect(stored.map(row => row.position)).toEqual([0, 1, 2])
		})

		it("links the topic or feature it evaluates", async () => {
			const topic = await createTopic("Embossed print")

			const created = await createSurvey("What did you think of that topic?", {
				subjectContentItemId: topic.id,
			})

			expect(created.currentVersion.content).toMatchObject({
				subjectContentItemId: topic.id,
			})
			const [detail] = await db.select().from(surveyDetails)
			expect(detail?.subjectContentItemId).toBe(topic.id)
		})

		it("refuses a survey about itself, which would make a trigger a loop", async () => {
			const created = await createSurvey("Standalone")
			const [detail] = await db.select().from(surveyDetails)

			await expect(
				db
					.update(surveyDetails)
					.set({ subjectContentItemId: created.id })
					.where(eq(surveyDetails.contentVersionId, detail!.contentVersionId))
			).rejects.toMatchObject({ cause: { constraint: "survey_detail_subject_check" } })
		})

		it("refuses a subject that does not exist", async () => {
			await expect(
				createSurvey("Dangling subject", {
					subjectContentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
				})
			).rejects.toThrow()
		})
	})

	describe("AC2 — the scales and the NPS bands are stored per the SRD", () => {
		it("stores 1-5 for a rating, 0-10 and 9/7 for an NPS, and nothing for text", async () => {
			await createSurvey("Every kind", {
				purpose: "nps",
				questions: [ratingQuestion, npsQuestion, textQuestion],
			})

			const stored = await db.select().from(surveyQuestions).orderBy(surveyQuestions.position)
			expect(stored[0]).toMatchObject({
				kind: "rating",
				scaleMin: 1,
				scaleMax: 5,
				lowLabel: "Not clear at all",
				highLabel: "Very clear",
				npsPromoterMin: null,
				npsPassiveMin: null,
				required: true,
			})
			// Promoter 9-10, passive 7-8, detractor 0-6: the banding is data a
			// report reads, not arithmetic every reader repeats.
			expect(stored[1]).toMatchObject({
				kind: "nps",
				scaleMin: 0,
				scaleMax: 10,
				npsPromoterMin: 9,
				npsPassiveMin: 7,
			})
			expect(stored[2]).toMatchObject({
				kind: "text",
				scaleMin: null,
				scaleMax: null,
				lowLabel: null,
				highLabel: null,
				npsPromoterMin: null,
				required: false,
			})
		})

		it("refuses a scale the SRD does not state, even when the contract is bypassed", async () => {
			await createSurvey("Every kind", { questions: [ratingQuestion] })
			const [stored] = await db.select().from(surveyQuestions)

			for (const [patch, constraint] of [
				[{ scaleMax: 7 }, "survey_question_shape_check"],
				[{ npsPromoterMin: 8 }, "survey_question_shape_check"],
				[{ lowLabel: null }, "survey_question_shape_check"],
				[{ kind: "poll" as never }, "survey_question_kind_check"],
				[{ position: 20 }, "survey_question_position_check"],
				[{ prompt: "<b>Rate</b>" }, "survey_question_prompt_check"],
			] as const) {
				await expect(
					db.update(surveyQuestions).set(patch).where(eq(surveyQuestions.id, stored!.id))
				).rejects.toMatchObject({ cause: { constraint } })
			}
		})

		it("refuses two questions claiming the same position", async () => {
			await createSurvey("Two questions", { questions: [ratingQuestion, textQuestion] })
			const rows = await db.select().from(surveyQuestions).orderBy(surveyQuestions.position)

			await expect(
				db.update(surveyQuestions).set({ position: 0 }).where(eq(surveyQuestions.id, rows[1]!.id))
			).rejects.toMatchObject({
				cause: { constraint: "survey_question_version_position_unique" },
			})
		})
	})

	describe("AC3 — CM-3's workflow applies, and only published surveys bundle", () => {
		it("carries the questions onto every version a transition creates", async () => {
			const created = await createSurvey("Carried forward", {
				questions: [ratingQuestion, npsQuestion],
			})

			await publish(created.id)

			const detail = await contentService.get(created.id)
			expect(detail.status).toBe("published")
			// A transition creates a new version row; a survey whose questions did
			// not come with it would be a survey with nothing to ask.
			expect((detail.currentVersion.content as { questions: unknown[] }).questions).toEqual([
				ratingQuestion,
				npsQuestion,
			])
			const versions = await db.select().from(surveyDetails)
			expect(versions).toHaveLength(4)
			const counted = await db.execute<{ versions: string }>(sql`
				select count(distinct content_version_id)::text as versions from survey_question
			`)
			expect(counted.rows[0]?.versions).toBe("4")
		})

		it("keeps a draft survey out of the bundle and lets a published one in", async () => {
			const draft = await createSurvey("Still a draft")
			const live = await createSurvey("Published", { purpose: "usefulness" })
			await publish(live.id)

			const { candidates } = await workflow.listPublishedBundleCandidates()

			expect(candidates.map(candidate => candidate.itemId)).toEqual([live.id])
			expect(candidates.map(candidate => candidate.itemId)).not.toContain(draft.id)
		})

		it("renders a published survey with its purpose and questions", async () => {
			const live = await createSurvey("Bundled", {
				purpose: "usefulness",
				questions: [ratingQuestion, textQuestion],
			})
			await publish(live.id)

			const { candidates } = await workflow.listPublishedBundleCandidates()
			const [resource] = renderPublishedContentResources(candidates)
			const document = JSON.parse(resource!.bytes.toString("utf8")) as Record<string, unknown>

			expect(document).toMatchObject({
				contentType: "survey",
				purpose: "usefulness",
				subjectContentItemId: null,
				questions: [ratingQuestion, textQuestion],
			})
			// The trivia keys belong to a question document, and a client that
			// checks its keys exactly must not see them here.
			expect(document).not.toHaveProperty("choices")
			expect(document).not.toHaveProperty("difficulty")
		})
	})

	describe("editing a survey", () => {
		it("replaces the questions on the new version and leaves the old one intact", async () => {
			const created = await createSurvey("Editable", { questions: [ratingQuestion] })
			const firstVersionId = created.currentVersion.id

			const updated = await contentService.update(
				{
					itemId: created.id,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 1,
					content: survey("Editable", { questions: [npsQuestion, textQuestion] }),
					relatedLinks: [],
				},
				EDITOR_ID
			)

			expect(updated.currentVersion.versionNo).toBe(2)
			expect((updated.currentVersion.content as { questions: unknown[] }).questions).toEqual([
				npsQuestion,
				textQuestion,
			])
			const original = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.contentVersionId, firstVersionId))
			expect(original).toHaveLength(1)
			expect(original[0]).toMatchObject({ kind: "rating" })
		})

		it("records what changed, so the audit trail names the questions", async () => {
			const created = await createSurvey("Audited", { questions: [ratingQuestion] })

			await contentService.update(
				{
					itemId: created.id,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 1,
					content: survey("Audited", {
						purpose: "feature",
						questions: [ratingQuestion, textQuestion],
					}),
					relatedLinks: [],
				},
				EDITOR_ID
			)

			const rows = await db.execute<{ newValue: { changedFields: string[] } }>(sql`
				select new_value as "newValue" from audit_log where action = 'content.edit'
			`)
			expect(rows.rows[0]?.newValue.changedFields).toEqual(
				expect.arrayContaining(["purpose", "questions"])
			)
		})
	})

	describe("listing surveys", () => {
		it("filters by purpose and reports how many questions each asks", async () => {
			await createSurvey("A satisfaction survey", {
				purpose: "satisfaction",
				questions: [ratingQuestion, textQuestion],
			})
			await createSurvey("A topic survey", { purpose: "topic", questions: [ratingQuestion] })

			const satisfaction = await contentService.list({ page: 1, limit: 20, purpose: "satisfaction" })
			const all = await contentService.list({ page: 1, limit: 20, contentType: "survey" })

			expect(satisfaction.total).toBe(1)
			expect(satisfaction.items[0]).toMatchObject({
				contentType: "survey",
				purpose: "satisfaction",
				questionCount: 2,
			})
			expect(all.total).toBe(2)
			expect(
				all.items.map(item => (item as { questionCount: number }).questionCount).sort()
			).toEqual([1, 2])
		})
	})
})
