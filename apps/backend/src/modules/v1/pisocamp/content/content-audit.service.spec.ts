import { sql } from "drizzle-orm"

import { auditLog } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ListPisoCampContentAuditOutputSchema } from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/content-audit.schema"
import { ContentAuditService } from "./content-audit.service"
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

const EDITOR_ID = "cm7-editor"
const APPROVER_ID = "cm7-approver"

const advisory = (title = "Handle banknotes with care") => ({
	contentType: "advisory" as const,
	title,
	summary: "Approved advisory copy.",
	body: "Do not fold, staple or write on Philippine banknotes.",
})

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

describe("CM-7 content audit history", () => {
	let contentService: ContentService
	let workflow: ContentWorkflowService
	let service: ContentAuditService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, version_asset, asset, asset_object,
				related_link, content_version, content_item, audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'Elena Editor', 'cm7-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'Sam Rivera', 'cm7-approver@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, version_asset, asset, asset_object,
				related_link, content_version, content_item, audit_log, idempotency_keys
			restart identity cascade
		`)
		const audit = new AuditService()
		contentService = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
		service = new ContentAuditService()
	})

	afterAll(async () => {
		await db.$client.end()
	})

	/** create → edit → submit → approve → publish → unpublish */
	async function fullHistory() {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [] },
			EDITOR_ID
		)
		await contentService.update(
			{
				...correlation(created.id, 1),
				content: advisory("Handle banknotes with more care"),
				relatedLinks: [],
			},
			EDITOR_ID
		)
		await workflow.transition("submit", correlation(created.id, 2, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(created.id, 3, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(created.id, 4), APPROVER_ID)
		await workflow.transition("unpublish", correlation(created.id, 5, "Superseded"), APPROVER_ID)
		return created.id
	}

	it("shows every edit and transition with actor, time, states and comments", async () => {
		const itemId = await fullHistory()

		const history = ListPisoCampContentAuditOutputSchema.parse(
			await service.list({ itemId, page: 1, limit: 25 })
		)

		expect(history.total).toBe(6)
		expect(history.entries.map(entry => entry.action)).toEqual([
			"content.unpublish",
			"content.publish",
			"content.approve",
			"content.submit",
			"content.edit",
			"content.create",
		])

		const unpublish = history.entries[0]!
		expect(unpublish).toMatchObject({
			action: "content.unpublish",
			fromState: "published",
			toState: "unpublished",
			comments: "Superseded",
			actor: { id: APPROVER_ID, name: "Sam Rivera" },
			versionNo: 6,
		})
		expect(unpublish.at.endsWith("Z")).toBe(true)

		const approve = history.entries.find(entry => entry.action === "content.approve")!
		expect(approve).toMatchObject({
			fromState: "submitted_for_review",
			toState: "approved",
			comments: "Checked",
			actor: { id: APPROVER_ID },
		})

		// An edit is not a transition, so it has no states to show.
		const edit = history.entries.find(entry => entry.action === "content.edit")!
		expect(edit).toMatchObject({
			fromState: null,
			toState: null,
			actor: { id: EDITOR_ID, name: "Elena Editor" },
		})

		expect(history.actors.map(actor => actor.name)).toEqual(["Elena Editor", "Sam Rivera"])
	})

	it("narrows by actor, by action and by date range", async () => {
		const itemId = await fullHistory()

		const byActor = await service.list({ itemId, page: 1, limit: 25, actorId: EDITOR_ID })
		expect(byActor.total).toBe(3)
		expect(byActor.entries.every(entry => entry.actor?.id === EDITOR_ID)).toBe(true)

		const byAction = await service.list({
			itemId,
			page: 1,
			limit: 25,
			action: "content.approve",
		})
		expect(byAction.total).toBe(1)
		expect(byAction.entries[0]?.action).toBe("content.approve")

		const future = new Date(Date.now() + 86_400_000).toISOString()
		expect((await service.list({ itemId, page: 1, limit: 25, from: future })).total).toBe(0)

		const past = new Date(Date.now() - 86_400_000).toISOString()
		expect((await service.list({ itemId, page: 1, limit: 25, to: past })).total).toBe(0)
		expect((await service.list({ itemId, page: 1, limit: 25, from: past })).total).toBe(6)

		const combined = await service.list({
			itemId,
			page: 1,
			limit: 25,
			actorId: APPROVER_ID,
			action: "content.publish",
			from: past,
		})
		expect(combined.total).toBe(1)
	})

	it("pages newest-first without repeating an entry", async () => {
		const itemId = await fullHistory()

		const first = await service.list({ itemId, page: 1, limit: 4 })
		const second = await service.list({ itemId, page: 2, limit: 4 })

		expect(first.entries).toHaveLength(4)
		expect(second.entries).toHaveLength(2)
		expect(first.total).toBe(6)
		const ids = [...first.entries, ...second.entries].map(entry => entry.id)
		expect(new Set(ids).size).toBe(6)
	})

	it("scopes strictly to one item and includes its version-scoped entries", async () => {
		const itemId = await fullHistory()
		const other = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Another advisory"), relatedLinks: [] },
			EDITOR_ID
		)
		// A CM-5 preview is audited against a version, not the item.
		const [version] = await db
			.execute<{
				id: string
			}>(sql`select id from content_version where item_id = ${itemId} order by version_no limit 1`)
			.then(result => result.rows)
		await new AuditService().record({
			domain: "content",
			action: "content.preview",
			actorId: APPROVER_ID,
			targetType: "content_version",
			targetId: version!.id,
			newValue: { itemId, versionNo: 1, status: "draft" },
		})

		const history = await service.list({ itemId, page: 1, limit: 25 })
		const otherHistory = await service.list({ itemId: other.id, page: 1, limit: 25 })

		expect(history.total).toBe(7)
		expect(history.entries.some(entry => entry.action === "content.preview")).toBe(true)
		expect(otherHistory.total).toBe(1)
		expect(otherHistory.entries[0]?.action).toBe("content.create")
	})

	it("never shows a denial or another domain's entries", async () => {
		const itemId = await fullHistory()
		const audit = new AuditService()
		await audit.record({
			domain: "rbac",
			action: "permission_denied",
			outcome: "denied",
			actorId: EDITOR_ID,
			targetType: "content_item",
			targetId: itemId,
		})
		await audit.record({
			domain: "content",
			action: "content.publish",
			outcome: "denied",
			actorId: EDITOR_ID,
			targetType: "content_item",
			targetId: itemId,
		})

		const history = await service.list({ itemId, page: 1, limit: 25 })

		expect(history.total).toBe(6)
		expect(await db.select().from(auditLog)).toHaveLength(8)
	})

	it("refuses an unknown item rather than returning an empty history", async () => {
		await expect(
			service.list({ itemId: crypto.randomUUID(), page: 1, limit: 25 })
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})
})
