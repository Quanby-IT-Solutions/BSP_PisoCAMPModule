import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import { auditLog, surveyTriggerRules } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"
import { PisoCampService } from "../pisocamp.service"
import { SurveyTriggerService } from "./survey-trigger.service"

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

const EDITOR_ID = "ev3-editor"
const APPROVER_ID = "ev3-approver"

const question = {
	kind: "rating" as const,
	prompt: "How clear was this topic?",
	required: true,
	lowLabel: "Not clear at all",
	highLabel: "Very clear",
}

/**
 * EV-3. BSP decides when a survey is offered and how often; the device is told
 * through the same public configuration it already reads.
 */
describe("EV-3 survey trigger rules", () => {
	let triggers: SurveyTriggerService
	let content: ContentService
	let workflow: ContentWorkflowService
	let publishedId: string
	let secondId: string
	let draftId: string

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table survey_trigger_rule, survey_answer, survey_response,
				content_bundle_rebuild_request, version_asset, asset, asset_object,
				survey_question, survey_detail, trivia_question_detail, related_link,
				content_version, content_item, audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'EV3 Editor', 'ev3-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'EV3 Approver', 'ev3-approver@example.test', true, now(), now())
		`)

		const audit = new AuditService()
		content = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
		publishedId = await publishSurvey("How did we do?")
		secondId = await publishSurvey("And overall?")
		draftId = (await createSurvey("Still a draft")).id
	})

	beforeEach(async () => {
		triggers = new SurveyTriggerService(new AuditService())
		await db.delete(surveyTriggerRules)
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function createSurvey(title: string) {
		return content.create(
			{
				requestId: randomUUID(),
				content: {
					contentType: "survey",
					title,
					summary: "A short evaluation shown after a topic.",
					body: "Answering is optional.",
					purpose: "satisfaction",
					subjectContentItemId: null,
					questions: [question],
				},
				relatedLinks: [],
			},
			EDITOR_ID
		)
	}

	async function publishSurvey(title: string) {
		const created = await createSurvey(title)
		const correlation = (expectedVersionNo: number, comments?: string) =>
			({
				itemId: created.id,
				requestId: randomUUID(),
				expectedVersionNo,
				...(comments === undefined ? {} : { comments }),
			}) as never
		await workflow.transition("submit", correlation(1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(3), APPROVER_ID)
		return created.id
	}

	function rule(overrides: Record<string, unknown> = {}) {
		return {
			requestId: randomUUID(),
			actorId: APPROVER_ID,
			contentItemId: publishedId,
			triggerType: "topic_completion" as const,
			pageDepth: null,
			frequencyCapDays: 30,
			priority: 10,
			enabled: true,
			...overrides,
		} as never
	}

	describe("AC1 — a rule saves and reaches devices through the config", () => {
		it("saves the trigger, its parameters, cap and priority", async () => {
			const saved = await triggers.upsert(rule())

			expect(saved).toMatchObject({
				contentItemId: publishedId,
				surveyTitle: "How did we do?",
				triggerType: "topic_completion",
				pageDepth: null,
				frequencyCapDays: 30,
				priority: 10,
				enabled: true,
			})
			const [stored] = await db.select().from(surveyTriggerRules)
			expect(stored).toMatchObject({ priority: 10, frequencyCapDays: 30 })
		})

		it("saves a page-depth trigger with its depth", async () => {
			const saved = await triggers.upsert(
				rule({ triggerType: "page_depth", pageDepth: 5, frequencyCapDays: null })
			)

			expect(saved).toMatchObject({ triggerType: "page_depth", pageDepth: 5 })
			expect(saved.frequencyCapDays).toBeNull()
		})

		it("carries enabled rules on published surveys into the public config", async () => {
			await triggers.upsert(rule())
			await triggers.upsert(
				rule({ contentItemId: secondId, triggerType: "module_exit", priority: 20 })
			)
			await triggers.upsert(
				rule({ triggerType: "app_exit", priority: 5, enabled: false })
			)

			const config = await new PisoCampService(triggers).getPublicConfig()

			// Highest priority first, and the disabled rule is simply not sent:
			// the way to stop a device asking is to stop telling it to.
			expect(config.survey_triggers).toEqual([
				{
					contentItemId: publishedId,
					triggerType: "topic_completion",
					pageDepth: null,
					frequencyCapDays: 30,
					priority: 10,
				},
				{
					contentItemId: secondId,
					triggerType: "module_exit",
					pageDepth: null,
					frequencyCapDays: 30,
					priority: 20,
				},
			])
		})

		it("stops sending a rule whose survey is no longer published", async () => {
			// Its own survey: withdrawing one the other cases rely on would make
			// them depend on the order they happen to run in.
			const withdrawn = await publishSurvey("Withdrawn later")
			await triggers.upsert(rule({ contentItemId: withdrawn }))

			await workflow.transition(
				"unpublish",
				{
					itemId: withdrawn,
					requestId: randomUUID(),
					expectedVersionNo: 4,
					comments: "Withdrawn for review",
				} as never,
				APPROVER_ID
			)

			const config = await new PisoCampService(triggers).getPublicConfig()

			expect(config.survey_triggers).toEqual([])
			// The rule is kept, not deleted: republishing should not mean
			// arranging the trigger again from nothing.
			expect(await db.select().from(surveyTriggerRules)).toHaveLength(1)
		})

		it("refuses a rule for a draft survey and for something that is not a survey", async () => {
			await expect(
				triggers.upsert(rule({ contentItemId: draftId }))
			).rejects.toMatchObject({ code: "CONFLICT" })
			await expect(
				triggers.upsert(rule({ contentItemId: randomUUID() }))
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(await db.select().from(surveyTriggerRules)).toHaveLength(0)
		})

		it("replaces the rule for the same survey and trigger rather than adding one", async () => {
			await triggers.upsert(rule())

			const updated = await triggers.upsert(rule({ priority: 1, frequencyCapDays: 7 }))

			expect(updated).toMatchObject({ priority: 1, frequencyCapDays: 7 })
			expect(await db.select().from(surveyTriggerRules)).toHaveLength(1)
		})

		it("lets one survey carry a rule per trigger type", async () => {
			await triggers.upsert(rule())
			await triggers.upsert(rule({ triggerType: "module_exit" }))

			expect(await db.select().from(surveyTriggerRules)).toHaveLength(2)
		})
	})

	describe("AC4 — every change is audited", () => {
		it("records the creation, the change and the removal", async () => {
			await triggers.upsert(rule())
			await triggers.upsert(rule({ priority: 2 }))
			await triggers.remove({
				requestId: randomUUID(),
				actorId: APPROVER_ID,
				contentItemId: publishedId,
				triggerType: "topic_completion",
			} as never)

			const rows = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.targetType, "survey_trigger_rule"))
				.orderBy(auditLog.createdAt)
			expect(rows.map(row => row.action)).toEqual([
				"survey_trigger.create",
				"survey_trigger.update",
				"survey_trigger.delete",
			])
			// The change names what it changed, both before and after.
			expect(rows[1]?.oldValue).toMatchObject({ priority: 10 })
			expect(rows[1]?.newValue).toMatchObject({ priority: 2 })
			expect(rows[2]?.oldValue).toMatchObject({ triggerType: "topic_completion" })
		})

		it("reports removing a rule that was not there without auditing anything", async () => {
			await expect(
				triggers.remove({
					requestId: randomUUID(),
					actorId: APPROVER_ID,
					contentItemId: publishedId,
					triggerType: "app_exit",
				} as never)
			).resolves.toEqual({ deleted: false })

			expect(await db.select().from(auditLog)).toHaveLength(0)
		})
	})

	describe("the database refuses an impossible rule", () => {
		it("refuses a depth on a trigger that is not about depth", async () => {
			await triggers.upsert(rule())
			const [stored] = await db.select().from(surveyTriggerRules)

			await expect(
				db
					.update(surveyTriggerRules)
					.set({ pageDepth: 5 })
					.where(eq(surveyTriggerRules.id, stored!.id))
			).rejects.toMatchObject({
				cause: { constraint: "survey_trigger_rule_page_depth_check" },
			})
		})

		it("refuses a page-depth trigger with no depth", async () => {
			await triggers.upsert(
				rule({ triggerType: "page_depth", pageDepth: 5, frequencyCapDays: null })
			)
			const [stored] = await db.select().from(surveyTriggerRules)

			await expect(
				db
					.update(surveyTriggerRules)
					.set({ pageDepth: null })
					.where(eq(surveyTriggerRules.id, stored!.id))
			).rejects.toMatchObject({
				cause: { constraint: "survey_trigger_rule_page_depth_check" },
			})
		})

		it("refuses an unknown trigger, a priority off the scale and a year-long cap", async () => {
			await triggers.upsert(rule())
			const [stored] = await db.select().from(surveyTriggerRules)

			for (const [patch, constraint] of [
				[{ triggerType: "on_a_whim" as never }, "survey_trigger_rule_type_check"],
				[{ priority: 0 }, "survey_trigger_rule_priority_check"],
				[{ priority: 101 }, "survey_trigger_rule_priority_check"],
				[{ frequencyCapDays: 400 }, "survey_trigger_rule_frequency_check"],
			] as const) {
				await expect(
					db
						.update(surveyTriggerRules)
						.set(patch)
						.where(eq(surveyTriggerRules.id, stored!.id))
				).rejects.toMatchObject({ cause: { constraint } })
			}
		})

		it("refuses two rules for the same survey and trigger", async () => {
			await triggers.upsert(rule())

			await expect(
				db.insert(surveyTriggerRules).values({
					contentItemId: publishedId,
					triggerType: "topic_completion",
					priority: 30,
					enabled: true,
					createdBy: APPROVER_ID,
					updatedBy: APPROVER_ID,
				})
			).rejects.toMatchObject({
				cause: { constraint: "survey_trigger_rule_item_type_unique" },
			})
		})
	})
})
