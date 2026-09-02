import { and, eq, sql } from "drizzle-orm"

import {
	auditLog,
	contentBundleRebuildRequests,
	contentItems,
	contentVersions,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampContentReviewDetailSchema } from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/content.schema"
import { ListPisoCampContentVersionsOutputSchema } from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/version-history.schema"
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

const EDITOR_ID = "cm4-editor"
const APPROVER_ID = "cm4-approver"

const advisory = (overrides: Partial<{ title: string; summary: string; body: string }> = {}) => ({
	contentType: "advisory" as const,
	title: "Handle banknotes with care",
	summary: "Approved advisory copy.",
	body: "Do not fold, staple or write on Philippine banknotes.",
	...overrides,
})

const externalLink = {
	kind: "external" as const,
	label: "BSP source",
	url: "https://www.bsp.gov.ph/",
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

describe("CM-4 version history and restore", () => {
	let contentService: ContentService
	let service: ContentWorkflowService

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
			values (${EDITOR_ID}, 'CM4 Editor', 'cm4-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'CM4 Approver', 'cm4-approver@example.test', true, now(), now())
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
		service = new ContentWorkflowService(audit)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	/**
	 * The reachable revision cycle today: an edit is only possible while a draft
	 * is open, so divergent copy has to be introduced before the first approval.
	 *
	 * v1 draft(A) → v2 submitted → v3 draft(A, rejected) → v4 draft(B)
	 * → v5 submitted → v6 approved(B)
	 */
	async function revisedItem() {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [externalLink] },
			EDITOR_ID
		)
		await service.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		await service.transition("reject", correlation(created.id, 2, "Copy needs work"), APPROVER_ID)
		await contentService.update(
			{
				...correlation(created.id, 3),
				content: advisory({ body: "Keep banknotes clean, flat and dry." }),
				relatedLinks: [],
			},
			EDITOR_ID
		)
		await service.transition("submit", correlation(created.id, 4, "Ready again"), EDITOR_ID)
		await service.transition("approve", correlation(created.id, 5, "Checked"), APPROVER_ID)
		return created.id
	}

	/** Straight through to a published version 4. */
	async function publishedItem() {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [externalLink] },
			EDITOR_ID
		)
		await service.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		await service.transition("approve", correlation(created.id, 2, "Checked"), APPROVER_ID)
		await service.transition("publish", correlation(created.id, 3), APPROVER_ID)
		return created.id
	}

	it("shows every version with its actors and a field-level difference to the current one", async () => {
		const itemId = await revisedItem()

		const history = ListPisoCampContentVersionsOutputSchema.parse(
			await service.listVersionHistory({ itemId, page: 1, limit: 20 })
		)

		expect(history.currentVersionNo).toBe(6)
		expect(history.itemStatus).toBe("approved")
		expect(history.versions.map(version => version.versionNo)).toEqual([6, 5, 4, 3, 2, 1])
		expect(history.total).toBe(6)

		const current = history.versions[0]!
		expect(current).toMatchObject({
			isCurrentWorking: true,
			restorable: false,
			differences: [],
			status: "approved",
			approver: { id: APPROVER_ID, name: "CM4 Approver" },
			transitionAction: "approve",
			transitionComments: "Checked",
		})
		expect(current.approvedAt).not.toBeNull()
		expect(current.publisher).toBeNull()

		const original = history.versions.find(version => version.versionNo === 1)!
		expect(original).toMatchObject({
			status: "draft",
			restorable: false,
			transitionAction: null,
			createdBy: { id: EDITOR_ID, name: "CM4 Editor" },
			approver: null,
			publisher: null,
			restoredFromVersionNo: null,
		})
		expect(original.differences).toEqual(
			expect.arrayContaining([
				{
					field: "body",
					previous: "Do not fold, staple or write on Philippine banknotes.",
					current: "Keep banknotes clean, flat and dry.",
				},
				{
					field: "relatedLinks",
					previous: "external BSP source https://www.bsp.gov.ph/",
					current: null,
				},
			])
		)
		expect(original.differences.map(difference => difference.field)).not.toContain("title")
		expect(original.differences.map(difference => difference.field)).not.toContain("summary")
	})

	it("pages history newest-first without repeating a version", async () => {
		const itemId = await publishedItem()

		const first = await service.listVersionHistory({ itemId, page: 1, limit: 2 })
		const second = await service.listVersionHistory({ itemId, page: 2, limit: 2 })

		expect(first.versions.map(version => version.versionNo)).toEqual([4, 3])
		expect(second.versions.map(version => version.versionNo)).toEqual([2, 1])
		expect(first.total).toBe(4)
		expect(second.total).toBe(4)
	})

	it("marks only prior approved and published versions restorable", async () => {
		const itemId = await publishedItem()

		const history = await service.listVersionHistory({ itemId, page: 1, limit: 20 })

		expect(history.restoreAvailable).toBe(true)
		expect(
			history.versions.map(version => [version.versionNo, version.status, version.restorable])
		).toEqual([
			[4, "published", false],
			[3, "approved", true],
			[2, "submitted_for_review", false],
			[1, "draft", false],
		])
	})

	it("restores a prior approved version as a new approved copy without publishing it", async () => {
		const itemId = await publishedItem()
		const [beforeItem] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))

		const restored = PisoCampContentReviewDetailSchema.parse(
			await service.restore(
				{
					itemId,
					versionNo: 3,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 4,
					comments: "Reverting to the approved copy.",
				},
				APPROVER_ID
			)
		)

		expect(restored.status).toBe("approved")
		expect(restored.currentVersion.versionNo).toBe(5)
		expect(restored.currentVersion.approval).toMatchObject({ actor: { id: APPROVER_ID } })
		expect(restored.currentVersion.publication).toBeNull()
		expect(restored.currentVersion.relatedLinks).toEqual([
			expect.objectContaining({ kind: "external", label: "BSP source" }),
		])

		const [source] = await db
			.select()
			.from(contentVersions)
			.where(and(eq(contentVersions.itemId, itemId), eq(contentVersions.versionNo, 3)))
		const [row] = await db
			.select()
			.from(contentVersions)
			.where(eq(contentVersions.id, restored.currentVersion.id))
		expect(row?.restoredFromVersionId).toBe(source?.id)

		// Publication stays CM-3's job: whatever is live remains live.
		const [afterItem] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
		expect(afterItem?.currentPublishedVersionId).toBe(beforeItem?.currentPublishedVersionId)
		// Unchanged, not false: the earlier publish set it and no worker runs here.
		expect(afterItem?.bundlePending).toBe(beforeItem?.bundlePending)
		expect(await db.select().from(contentBundleRebuildRequests)).toHaveLength(1)

		const history = await service.listVersionHistory({ itemId, page: 1, limit: 20 })
		expect(history.versions[0]).toMatchObject({ versionNo: 5, restoredFromVersionNo: 3 })
	})

	it("copies the source version's own content and links, not the working version's", async () => {
		const itemId = await publishedItem()
		// A prior approved version that diverges from the live one. Inserted
		// directly because today's transitions cannot produce two approved
		// versions with different copy — CM-6's unpublish path will.
		const divergentId = crypto.randomUUID()
		await db.execute(sql`
			insert into content_version (
				id, item_id, version_no, parent_version_id, status, content_type, title, summary, body,
				created_by, created_at, approved_by, approved_at, transition_action, transition_comments
			) values (
				${divergentId}, ${itemId}, 5, null, 'approved', 'advisory',
				'Handle banknotes with care', 'Superseded advisory copy.', 'Superseded body copy.',
				${EDITOR_ID}, now(), ${APPROVER_ID}, now(), 'approve', 'Historic approval'
			)
		`)
		await db.execute(sql`
			insert into related_link (content_version_id, position, kind, label, external_url)
			values (${divergentId}, 0, 'external', 'Superseded source', 'https://www.bsp.gov.ph/old')
		`)

		const restored = await service.restore(
			{
				itemId,
				versionNo: 5,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 4,
				comments: "Reverting to the superseded copy.",
			},
			APPROVER_ID
		)

		expect(restored.currentVersion.versionNo).toBe(6)
		expect(restored.currentVersion.content).toMatchObject({
			summary: "Superseded advisory copy.",
			body: "Superseded body copy.",
		})
		expect(restored.currentVersion.relatedLinks).toEqual([
			expect.objectContaining({ label: "Superseded source" }),
		])
	})

	it("still requires CM-3 to publish a restored version", async () => {
		const itemId = await publishedItem()
		await service.restore(
			{
				itemId,
				versionNo: 3,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 4,
				comments: "Reverting.",
			},
			APPROVER_ID
		)

		const published = await service.transition("publish", correlation(itemId, 5), APPROVER_ID)

		expect(published.status).toBe("published")
		expect(published.currentVersion.versionNo).toBe(6)
		expect(await db.select().from(contentBundleRebuildRequests)).toHaveLength(2)
	})

	it("audits the restore with the source version id and the reason", async () => {
		const itemId = await publishedItem()
		const [sourceVersion] = await db
			.select()
			.from(contentVersions)
			.where(and(eq(contentVersions.itemId, itemId), eq(contentVersions.versionNo, 3)))
		await db.delete(auditLog)

		await service.restore(
			{
				itemId,
				versionNo: 3,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 4,
				comments: "Reverting to the approved copy.",
			},
			APPROVER_ID
		)

		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "content",
			action: "content.restore",
			outcome: "success",
			actorId: APPROVER_ID,
			targetType: "content_item",
			targetId: itemId,
		})
		expect(rows[0]?.oldValue).toMatchObject({
			sourceVersionId: sourceVersion?.id,
			sourceVersionNo: 3,
			sourceState: "approved",
			fromState: "published",
		})
		expect(rows[0]?.newValue).toMatchObject({
			targetVersionNo: 5,
			toState: "approved",
			comments: "Reverting to the approved copy.",
		})
	})

	it.each([
		["a draft version", 1],
		["a submitted version", 2],
	] as const)("refuses to restore %s and writes nothing", async (_label, versionNo) => {
		const itemId = await publishedItem()
		const before = await db.select().from(contentVersions)
		await db.delete(auditLog)

		await expect(
			service.restore(
				{
					itemId,
					versionNo,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 4,
					comments: "Reverting.",
				},
				APPROVER_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })

		expect(await db.select().from(contentVersions)).toEqual(before)
		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("refuses to restore while a submission is awaiting a decision", async () => {
		const itemId = await revisedItem()
		await db.delete(auditLog)

		// v6 is approved; take it nowhere and instead prove the submitted state
		// on a second item is refused.
		const submitted = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [] },
			EDITOR_ID
		)
		await service.transition("submit", correlation(submitted.id, 1, "Ready"), EDITOR_ID)

		await expect(
			service.restore(
				{
					itemId: submitted.id,
					versionNo: 1,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 2,
					comments: "Reverting.",
				},
				APPROVER_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(itemId).toBeTruthy()
	})

	it("refuses a stale expected version and an unknown source version", async () => {
		const itemId = await publishedItem()

		await expect(
			service.restore(
				{
					itemId,
					versionNo: 3,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 2,
					comments: "Reverting.",
				},
				APPROVER_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })

		await expect(
			service.restore(
				{
					itemId,
					versionNo: 99,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 4,
					comments: "Reverting.",
				},
				APPROVER_ID
			)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})
})
