import { Reflector } from "@nestjs/core"
import { and, eq, sql } from "drizzle-orm"
import { firstValueFrom, of } from "rxjs"

import {
	auditLog,
	contentBundleRebuildRequests,
	contentItems,
	contentVersions,
	idempotencyKeys,
	relatedLinks,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentWorkflowService } from "./content-workflow.service"
import { ContentService } from "./content.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
}))

const EDITOR_ID = "cm3-task4-idempotency-editor"
const FIRST_KEY = "93ae9ee0-1047-42d1-906a-cc7125ae2521"
const SECOND_KEY = "bd02444c-bbe1-475a-b5ee-42f9fdffcd53"
const IDEMPOTENCY_TRIGGER = "cm3_task4_force_idempotency_failure"
const IDEMPOTENCY_FUNCTION = "cm3_task4_force_idempotency_failure_fn"

describe("Content workflow idempotency transaction boundary", () => {
	let contentService: ContentService
	let workflowService: ContentWorkflowService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, related_link, content_version,
				content_item, audit_log, idempotency_keys, users restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'Workflow Editor', 'cm3-task4-editor@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(
			sql.raw(`drop trigger if exists "${IDEMPOTENCY_TRIGGER}" on "idempotency_keys"`)
		)
		await db.execute(sql.raw(`drop function if exists "${IDEMPOTENCY_FUNCTION}"()`))
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, related_link, content_version,
				content_item, audit_log, idempotency_keys restart identity cascade
		`)
		const auditService = new AuditService()
		contentService = new ContentService(auditService)
		workflowService = new ContentWorkflowService(auditService)
	})

	afterAll(async () => {
		await db.execute(
			sql.raw(`drop trigger if exists "${IDEMPOTENCY_TRIGGER}" on "idempotency_keys"`)
		)
		await db.execute(sql.raw(`drop function if exists "${IDEMPOTENCY_FUNCTION}"()`))
		await db.$client.end()
	})

	async function createDraft() {
		return contentService.create(
			{
				requestId: crypto.randomUUID(),
				content: {
					contentType: "advisory",
					title: "Workflow idempotency",
					summary: "Transactional replay",
					body: "One immutable transition per logical request.",
				},
				relatedLinks: [{ kind: "external", label: "BSP", url: "https://www.bsp.gov.ph/" }],
			},
			EDITOR_ID
		)
	}

	async function executeTransition(
		action: "submit" | "approve" | "reject" | "publish",
		itemId: string,
		key: string,
		expectedVersionNo: number,
		comments: string
	) {
		const input = {
			itemId,
			requestId: key,
			expectedVersionNo,
			comments,
		}
		const reflector = new Reflector()
		jest.spyOn(reflector, "getAllAndOverride").mockReturnValue({
			requestIdField: "requestId",
			requireActiveAccount: true,
		})
		const interceptor = new IdempotencyInterceptor(
			{ isActive: async () => true } as never,
			reflector,
			new IdempotencyService()
		)
		const procedure = {
			"~orpc": {
				route: { method: "POST", path: `/admin/pisocamp/content/{itemId}/${action}` },
				handler: (_options?: unknown) => workflowService.transition(action, input, EDITOR_ID),
			},
		}
		const context = {
			getHandler: () => context,
			getClass: () => class ContentWorkflowMutation {},
			switchToHttp: () => ({
				getRequest: () => ({
					headers: { "idempotency-key": key },
					session: { user: { id: EDITOR_ID } },
				}),
			}),
		} as never
		const wrapped = (await firstValueFrom(
			await interceptor.intercept(context, { handle: () => of(procedure) } as never)
		)) as typeof procedure
		return wrapped["~orpc"].handler({ input } as never)
	}

	function executeSubmit(itemId: string, key: string, comments = "Ready for review") {
		return executeTransition("submit", itemId, key, 1, comments)
	}

	async function counts(itemId: string) {
		return {
			items: (await db.select().from(contentItems).where(eq(contentItems.id, itemId))).length,
			versions: (await db.select().from(contentVersions).where(eq(contentVersions.itemId, itemId)))
				.length,
			links: (
				await db
					.select()
					.from(relatedLinks)
					.innerJoin(contentVersions, eq(relatedLinks.contentVersionId, contentVersions.id))
					.where(eq(contentVersions.itemId, itemId))
			).length,
			audits: (await db.select().from(auditLog).where(eq(auditLog.targetId, itemId))).length,
			outbox: (
				await db
					.select()
					.from(contentBundleRebuildRequests)
					.where(eq(contentBundleRebuildRequests.itemId, itemId))
			).length,
			idempotency: (
				await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.authorId, EDITOR_ID))
			).length,
		}
	}

	it("returns the exact rich response on replay without duplicating lifecycle rows", async () => {
		const draft = await createDraft()
		const first = await executeSubmit(draft.id, FIRST_KEY)
		const afterFirst = await counts(draft.id)
		const replay = await executeSubmit(draft.id, FIRST_KEY)

		expect(replay).toEqual(first)
		expect(await counts(draft.id)).toEqual(afterFirst)
		expect(afterFirst).toEqual({
			items: 1,
			versions: 2,
			links: 2,
			audits: 2,
			outbox: 0,
			idempotency: 1,
		})
	})

	it("rejects the same actor/key across workflow actions without executing the second action", async () => {
		const draft = await createDraft()
		await executeSubmit(draft.id, FIRST_KEY)
		const afterSubmit = await counts(draft.id)

		await expect(
			executeTransition("approve", draft.id, FIRST_KEY, 2, "Source verified")
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(await counts(draft.id)).toEqual(afterSubmit)
	})

	it("rejects the same actor/key for a different item without transitioning that item", async () => {
		const firstDraft = await createDraft()
		const secondDraft = await createDraft()
		await executeSubmit(firstDraft.id, FIRST_KEY)
		const secondBaseline = await counts(secondDraft.id)

		await expect(executeSubmit(secondDraft.id, FIRST_KEY)).rejects.toMatchObject({
			code: "CONFLICT",
		})
		expect(await counts(secondDraft.id)).toEqual(secondBaseline)
	})

	it("rejects changed workflow comments under the same actor/key without another transition", async () => {
		const draft = await createDraft()
		await executeSubmit(draft.id, FIRST_KEY, "First review context")
		const afterSubmit = await counts(draft.id)

		await expect(
			executeSubmit(draft.id, FIRST_KEY, "Changed review context")
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(await counts(draft.id)).toEqual(afterSubmit)
	})

	it("serializes concurrent same-key requests and executes the transition once", async () => {
		const draft = await createDraft()
		const [first, replay] = await Promise.all([
			executeSubmit(draft.id, FIRST_KEY),
			executeSubmit(draft.id, FIRST_KEY),
		])

		expect(replay).toEqual(first)
		expect(await counts(draft.id)).toEqual({
			items: 1,
			versions: 2,
			links: 2,
			audits: 2,
			outbox: 0,
			idempotency: 1,
		})
	})

	it("lets the service row lock serialize different keys so one stale request conflicts", async () => {
		const draft = await createDraft()
		const outcomes = await Promise.allSettled([
			executeSubmit(draft.id, FIRST_KEY),
			executeSubmit(draft.id, SECOND_KEY),
		])

		expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1)
		expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1)
		expect(await counts(draft.id)).toEqual({
			items: 1,
			versions: 2,
			links: 2,
			audits: 2,
			outbox: 0,
			idempotency: 1,
		})
	})

	it("rolls back snapshot, links, audit, and item state when idempotency persistence fails", async () => {
		const draft = await createDraft()
		const baseline = await counts(draft.id)
		await db.execute(
			sql.raw(
				`create function "${IDEMPOTENCY_FUNCTION}"() returns trigger language plpgsql as $$ begin raise exception 'forced idempotency failure'; end $$`
			)
		)
		await db.execute(
			sql.raw(
				`create trigger "${IDEMPOTENCY_TRIGGER}" before insert on "idempotency_keys" for each row execute function "${IDEMPOTENCY_FUNCTION}"()`
			)
		)

		await expect(executeSubmit(draft.id, FIRST_KEY)).rejects.toThrow()
		expect(await counts(draft.id)).toEqual(baseline)
		expect(
			await db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.targetId, draft.id), eq(auditLog.action, "content.submit")))
		).toHaveLength(0)
	})
})
