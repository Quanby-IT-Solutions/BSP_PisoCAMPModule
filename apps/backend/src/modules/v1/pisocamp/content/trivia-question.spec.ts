import { eq, sql } from "drizzle-orm"

import { triviaQuestionDetails } from "@repo/db/schema"

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

const EDITOR_ID = "gm1-editor"
const APPROVER_ID = "gm1-approver"

function question(
	title: string,
	overrides: {
		active?: boolean
		category?: string
		difficulty?: "easy" | "medium" | "hard"
		choices?: { label: string; correct: boolean }[]
	} = {}
) {
	return {
		contentType: "trivia_question" as const,
		title,
		summary: "A question about what to check on a banknote.",
		body: "The embossed value is raised, so it can be felt with a fingertip.",
		category: overrides.category ?? "security-features",
		difficulty: overrides.difficulty ?? ("easy" as const),
		choices: overrides.choices ?? [
			{ label: "The embossed value", correct: true },
			{ label: "The serial number", correct: false },
			{ label: "The watermark", correct: false },
		],
		active: overrides.active ?? true,
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
 * GM-1. A question is content: it uses CM-3's workflow unchanged, and this
 * suite is about what a question adds — its choices, its category and
 * difficulty, and the active flag that withholds it from selection.
 */
describe("GM-1 trivia questions through the content workflow", () => {
	let contentService: ContentService
	let workflow: ContentWorkflowService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, version_asset, asset, asset_object,
				trivia_question_detail, related_link, content_version, content_item, audit_log,
				idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'GM1 Editor', 'gm1-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'GM1 Approver', 'gm1-approver@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, trivia_question_detail, related_link,
				content_version, content_item, audit_log, idempotency_keys
			restart identity cascade
		`)
		const audit = new AuditService()
		contentService = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function createQuestion(...args: Parameters<typeof question>) {
		return contentService.create(
			{ requestId: crypto.randomUUID(), content: question(...args), relatedLinks: [] },
			EDITOR_ID
		)
	}

	async function publish(itemId: string) {
		await workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(itemId, 2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(itemId, 3), APPROVER_ID)
	}

	it("saves a new question as a draft with its choices intact", async () => {
		const created = await createQuestion("Which feature is raised to the touch?")

		expect(created.status).toBe("draft")
		expect(created.currentVersion.status).toBe("draft")
		expect(created.currentVersion.content).toMatchObject({
			contentType: "trivia_question",
			category: "security-features",
			difficulty: "easy",
			active: true,
		})
		const content = created.currentVersion.content as { choices: unknown[] }
		expect(content.choices).toEqual([
			{ label: "The embossed value", correct: true },
			{ label: "The serial number", correct: false },
			{ label: "The watermark", correct: false },
		])
	})

	it("accepts two to six choices and refuses anything else", async () => {
		const two = await createQuestion("Two choices", {
			choices: [
				{ label: "Yes", correct: true },
				{ label: "No", correct: false },
			],
		})
		expect(two.status).toBe("draft")

		const six = await createQuestion("Six choices", {
			choices: [
				{ label: "One", correct: true },
				{ label: "Two", correct: false },
				{ label: "Three", correct: false },
				{ label: "Four", correct: false },
				{ label: "Five", correct: false },
				{ label: "Six", correct: false },
			],
		})
		expect(six.status).toBe("draft")

		await expect(
			createQuestion("One choice", { choices: [{ label: "Only", correct: true }] })
		).rejects.toThrow()
		await expect(
			createQuestion("Seven choices", {
				choices: Array.from({ length: 7 }, (_, index) => ({
					label: `Choice ${index}`,
					correct: index === 0,
				})),
			})
		).rejects.toThrow()
	})

	it("refuses a question with no correct answer or with more than one", async () => {
		for (const choices of [
			[
				{ label: "A", correct: false },
				{ label: "B", correct: false },
			],
			[
				{ label: "A", correct: true },
				{ label: "B", correct: true },
			],
		]) {
			await expect(createQuestion("Bad question", { choices })).rejects.toThrow()
		}

		expect(await db.execute(sql`select 1 from trivia_question_detail`)).toMatchObject({
			rowCount: 0,
		})
	})

	it("carries the choices forward through every transition", async () => {
		const created = await createQuestion("Which feature is raised to the touch?")
		await publish(created.id)

		// A question whose choices did not follow it through the workflow would
		// reach a device with no answers.
		const rows = await db
			.select()
			.from(triviaQuestionDetails)
			.where(eq(triviaQuestionDetails.contentItemId, created.id))
		expect(rows).toHaveLength(4)
		for (const row of rows) {
			expect(row.choices).toHaveLength(3)
			expect(row.category).toBe("security-features")
			expect(row.difficulty).toBe("easy")
		}

		const { candidates } = await workflow.listPublishedBundleCandidates()
		expect(candidates).toHaveLength(1)
		expect(candidates[0]!.content).toMatchObject({
			contentType: "trivia_question",
			difficulty: "easy",
		})
	})

	it("renders a published question into the bundle with its choices", async () => {
		const created = await createQuestion("Which feature is raised to the touch?")
		await publish(created.id)

		const { candidates } = await workflow.listPublishedBundleCandidates()
		const [resource] = renderPublishedContentResources(candidates)
		const document = JSON.parse(resource!.bytes.toString("utf8")) as Record<string, unknown>

		expect(document.contentType).toBe("trivia_question")
		expect(document.category).toBe("security-features")
		expect(document.difficulty).toBe("easy")
		expect(document.choices).toHaveLength(3)
		// The correct answer travels with the question: selection and marking
		// both happen on the device, offline.
		expect(document.choices).toContainEqual({
			label: "The embossed value",
			correct: true,
		})
	})

	it("withholds an inactive question from the bundle even when published", async () => {
		const shown = await createQuestion("Shown question")
		await publish(shown.id)
		const hidden = await createQuestion("Hidden question", { active: false })
		await publish(hidden.id)

		const { candidates, exclusions } = await workflow.listPublishedBundleCandidates()

		expect(candidates.map(candidate => candidate.itemId)).toEqual([shown.id])
		expect(exclusions).toEqual([
			{
				itemId: hidden.id,
				versionId: expect.any(String),
				reason: "inactive_trivia_question",
			},
		])
		// Withheld, not withdrawn.
		const rows = await db.execute<{ status: string }>(
			sql`select status from content_item where id = ${hidden.id}`
		)
		expect(rows.rows[0]?.status).toBe("published")
		expect(
			renderPublishedContentResources(candidates)[0]!.bytes.toString("utf8")
		).not.toContain("Hidden question")
	})

	it("follows CM-3 exactly, with no workflow of its own", async () => {
		const created = await createQuestion("Which feature is raised to the touch?")

		// The same guards CM-3 applies to every other content type.
		await expect(
			workflow.transition("approve", correlation(created.id, 1, "Too early"), APPROVER_ID)
		).rejects.toThrow()
		await expect(
			workflow.transition("submit", correlation(created.id, 99), EDITOR_ID)
		).rejects.toThrow()

		await workflow.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		const afterSubmit = await workflow.getReviewDetail(created.id)
		expect(afterSubmit.status).toBe("submitted_for_review")

		await workflow.transition("reject", correlation(created.id, 2, "Reword"), APPROVER_ID)
		expect((await workflow.getReviewDetail(created.id)).status).toBe("draft")
	})

	it("edits a question into a new version without touching the old one", async () => {
		const created = await createQuestion("Which feature is raised to the touch?")
		const updated = await contentService.update(
			{
				itemId: created.id,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 1,
				content: question("Which feature is raised to the touch?", {
					difficulty: "medium",
					active: false,
				}),
				relatedLinks: [],
			},
			EDITOR_ID
		)

		expect(updated.currentVersion.versionNo).toBe(2)
		expect(updated.currentVersion.content).toMatchObject({
			difficulty: "medium",
			active: false,
		})
		const rows = await db
			.select()
			.from(triviaQuestionDetails)
			.where(eq(triviaQuestionDetails.contentItemId, created.id))
		expect(rows).toHaveLength(2)
		expect(rows.map(row => row.difficulty).sort()).toEqual(["easy", "medium"])
	})

	describe("the database enforces the rule the contract states", () => {
		async function violatedConstraint(operation: () => Promise<unknown>) {
			try {
				await operation()
				return null
			} catch (error) {
				const cause = (error as { cause?: { constraint?: string } }).cause
				return cause?.constraint ?? (error as { constraint?: string }).constraint ?? null
			}
		}

		async function insertDetail(choices: string, category = "'security-features'") {
			const created = await createQuestion("Direct insert")
			const versionId = created.currentVersion.id
			await db.execute(sql`delete from trivia_question_detail where content_version_id = ${versionId}`)
			await db.execute(
				sql.raw(`
					insert into trivia_question_detail
						(content_version_id, content_item_id, category, difficulty, choices)
					values ('${versionId}', '${created.id}', ${category}, 'easy', '${choices}'::jsonb)
				`)
			)
		}

		it("refuses a choice list that is not two to six entries", async () => {
			expect(
				await violatedConstraint(() => insertDetail('[{"label":"A","correct":true}]'))
			).toBe("trivia_question_detail_choices_shape_check")
		})

		it("refuses a question without exactly one correct answer", async () => {
			expect(
				await violatedConstraint(() =>
					insertDetail('[{"label":"A","correct":true},{"label":"B","correct":true}]')
				)
			).toBe("trivia_question_detail_choices_correct_check")
		})

		it("refuses duplicate, empty or marked-up choice labels", async () => {
			const cases = [
				['duplicate', '[{"label":"A","correct":true},{"label":"A","correct":false}]'],
				['empty', '[{"label":"","correct":true},{"label":"B","correct":false}]'],
				['markup', '[{"label":"<b>A</b>","correct":true},{"label":"B","correct":false}]'],
			] as const
			const refused: [string, string | null][] = []
			for (const [label, choices] of cases) {
				refused.push([label, await violatedConstraint(() => insertDetail(choices))])
			}

			expect(refused).toEqual(
				cases.map(([label]) => [label, "trivia_question_detail_choices_labels_check"])
			)
		})

		it("refuses a category that is not a catalog code", async () => {
			expect(
				await violatedConstraint(() =>
					insertDetail(
						'[{"label":"A","correct":true},{"label":"B","correct":false}]',
						"'Security Features'"
					)
				)
			).toBe("trivia_question_detail_category_check")
		})
	})
})
