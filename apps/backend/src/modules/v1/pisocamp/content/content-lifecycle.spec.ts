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
import { ContentScheduleWorker } from "./content-schedule.worker"
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

const EDITOR_ID = "cm6-editor"
const APPROVER_ID = "cm6-approver"

const advisory = () => ({
	contentType: "advisory" as const,
	title: "Handle banknotes with care",
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

describe("CM-6 withdrawal transitions and scheduled publication", () => {
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
			values (${EDITOR_ID}, 'CM6 Editor', 'cm6-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'CM6 Approver', 'cm6-approver@example.test', true, now(), now())
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

	/** draft(1) → submitted(2) → approved(3) */
	async function approvedItem() {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [] },
			EDITOR_ID
		)
		await service.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		await service.transition("approve", correlation(created.id, 2, "Checked"), APPROVER_ID)
		return created.id
	}

	/** …→ published(4) */
	async function publishedItem() {
		const itemId = await approvedItem()
		await service.transition("publish", correlation(itemId, 3), APPROVER_ID)
		return itemId
	}

	async function bundleCandidateIds() {
		const { candidates } = await service.listPublishedBundleCandidates()
		return candidates.map(candidate => candidate.itemId)
	}

	it("unpublishes a published item, drops it from the bundle and queues a rebuild", async () => {
		const itemId = await publishedItem()
		expect(await bundleCandidateIds()).toEqual([itemId])
		await db.delete(auditLog)

		const detail = PisoCampContentReviewDetailSchema.parse(
			await service.transition(
				"unpublish",
				correlation(itemId, 4, "Superseded by the new advisory"),
				APPROVER_ID
			)
		)

		expect(detail.status).toBe("unpublished")
		expect(detail.currentVersion.versionNo).toBe(5)
		expect(detail.currentVersion.transition).toEqual({
			action: "unpublish",
			comments: "Superseded by the new advisory",
		})
		// Provenance survives the withdrawal.
		expect(detail.currentVersion.approval).not.toBeNull()
		expect(detail.currentVersion.publication).not.toBeNull()

		expect(await bundleCandidateIds()).toEqual([])
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
		expect(item).toMatchObject({ currentPublishedVersionId: null, bundlePending: true })
		// Two requests: the publish that put it in, and the unpublish that takes
		// it out. The second is keyed on the version this transition created.
		const requests = await db.select().from(contentBundleRebuildRequests)
		expect(requests).toHaveLength(2)
		expect(requests.map(request => request.publishedVersionId)).toContain(detail.currentVersion.id)

		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "content",
			action: "content.unpublish",
			outcome: "success",
			actorId: APPROVER_ID,
			targetId: itemId,
		})
		expect(rows[0]?.oldValue).toMatchObject({ fromState: "published" })
		expect(rows[0]?.newValue).toMatchObject({ toState: "unpublished" })
	})

	it.each([["published", 4] as const, ["unpublished", 5] as const])(
		"deactivates a %s item so it is never presented again",
		async (from, expectedVersionNo) => {
			const itemId = await publishedItem()
			if (from === "unpublished") {
				await service.transition("unpublish", correlation(itemId, 4), APPROVER_ID)
			}

			const detail = await service.transition(
				"deactivate",
				correlation(itemId, expectedVersionNo, "Demonetised series"),
				APPROVER_ID
			)

			expect(detail.status).toBe("deactivated")
			expect(await bundleCandidateIds()).toEqual([])
			const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
			expect(item?.currentPublishedVersionId).toBeNull()
		}
	)

	it("archives a deactivated item, keeping every version on record", async () => {
		const itemId = await publishedItem()
		await service.transition("deactivate", correlation(itemId, 4, "Demonetised"), APPROVER_ID)

		const detail = await service.transition("archive", correlation(itemId, 5), APPROVER_ID)

		expect(detail.status).toBe("archived")
		expect(await bundleCandidateIds()).toEqual([])
		// BR-001 retention: nothing is deleted.
		expect(await db.select().from(contentVersions)).toHaveLength(6)
	})

	it.each([
		["unpublish", "approved", 3] as const,
		["archive", "published", 4] as const,
		["deactivate", "approved", 3] as const,
	])("refuses %s from %s and writes nothing", async (action, _from, expectedVersionNo) => {
		const itemId = action === "archive" ? await publishedItem() : await approvedItem()
		const before = await db.select().from(contentVersions)
		await db.delete(auditLog)

		await expect(
			service.transition(action, correlation(itemId, expectedVersionNo), APPROVER_ID)
		).rejects.toMatchObject({ code: "CONFLICT" })

		expect(await db.select().from(contentVersions)).toEqual(before)
		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("refuses to archive without first deactivating", async () => {
		const itemId = await publishedItem()
		await service.transition("unpublish", correlation(itemId, 4), APPROVER_ID)

		await expect(
			service.transition("archive", correlation(itemId, 5), APPROVER_ID)
		).rejects.toMatchObject({ code: "CONFLICT" })
	})

	it("records and clears a scheduled publication, attributing it to the approver", async () => {
		const itemId = await approvedItem()
		const publishAt = new Date(Date.now() + 3_600_000).toISOString()
		await db.delete(auditLog)

		const scheduled = PisoCampContentReviewDetailSchema.parse(
			await service.schedulePublication(
				{ itemId, requestId: crypto.randomUUID(), expectedVersionNo: 3, publishAt },
				APPROVER_ID
			)
		)
		expect(scheduled.publishAt).toBe(publishAt)
		const [withSchedule] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
		expect(withSchedule?.publishAtBy).toBe(APPROVER_ID)

		const cleared = await service.schedulePublication(
			{ itemId, requestId: crypto.randomUUID(), expectedVersionNo: 3, publishAt: null },
			APPROVER_ID
		)
		expect(cleared.publishAt).toBeNull()
		const [withoutSchedule] = await db
			.select()
			.from(contentItems)
			.where(eq(contentItems.id, itemId))
		expect(withoutSchedule?.publishAtBy).toBeNull()

		const rows = await db.select().from(auditLog)
		expect(rows.map(row => row.action)).toEqual(["content.schedule", "content.schedule"])
		expect(rows[0]?.newValue).toMatchObject({ publishAt, publishAtBy: APPROVER_ID })
		expect(rows[1]?.newValue).toMatchObject({ publishAt: null, publishAtBy: null })
	})

	it("refuses a schedule in the past and a schedule on content that is not approved", async () => {
		const itemId = await approvedItem()

		await expect(
			service.schedulePublication(
				{
					itemId,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 3,
					publishAt: new Date(Date.now() - 1_000).toISOString(),
				},
				APPROVER_ID
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })

		await service.transition("publish", correlation(itemId, 3), APPROVER_ID)
		await expect(
			service.schedulePublication(
				{
					itemId,
					requestId: crypto.randomUUID(),
					expectedVersionNo: 4,
					publishAt: new Date(Date.now() + 3_600_000).toISOString(),
				},
				APPROVER_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
	})

	it("publishes a due schedule through the transition service and is safe to re-run", async () => {
		const itemId = await approvedItem()
		await service.schedulePublication(
			{
				itemId,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 3,
				publishAt: new Date(Date.now() + 60_000).toISOString(),
			},
			APPROVER_ID
		)
		await db.delete(auditLog)

		// Not yet due.
		expect(await service.publishDueScheduled(new Date(Date.now() - 1_000))).toEqual({
			published: [],
			failed: [],
		})
		expect(await db.select().from(auditLog)).toHaveLength(0)

		const later = new Date(Date.now() + 120_000)
		expect(await service.publishDueScheduled(later)).toEqual({ published: [itemId], failed: [] })

		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
		expect(item).toMatchObject({ status: "published", publishAt: null, publishAtBy: null })
		const [version] = await db
			.select()
			.from(contentVersions)
			.where(and(eq(contentVersions.itemId, itemId), eq(contentVersions.versionNo, 4)))
		// Attributed to the approver who scheduled it, not to a synthetic actor.
		expect(version?.publishedBy).toBe(APPROVER_ID)

		// Idempotent: a second run finds nothing due and writes nothing more.
		expect(await service.publishDueScheduled(later)).toEqual({ published: [], failed: [] })
		const rows = await db.select().from(auditLog)
		expect(rows.map(row => row.action)).toEqual(["content.publish"])
		expect(await db.select().from(contentBundleRebuildRequests)).toHaveLength(1)
	})

	it("clears a schedule when the item transitions by hand instead", async () => {
		const itemId = await approvedItem()
		await service.schedulePublication(
			{
				itemId,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 3,
				publishAt: new Date(Date.now() + 60_000).toISOString(),
			},
			APPROVER_ID
		)

		await service.transition("publish", correlation(itemId, 3), APPROVER_ID)

		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
		expect(item).toMatchObject({ publishAt: null, publishAtBy: null })
		expect(await service.publishDueScheduled(new Date(Date.now() + 120_000))).toEqual({
			published: [],
			failed: [],
		})
	})

	it("does nothing at all when the schedule worker is disabled", async () => {
		const itemId = await approvedItem()
		await service.schedulePublication(
			{
				itemId,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 3,
				publishAt: new Date(Date.now() - 1_000 + 2_000).toISOString(),
			},
			APPROVER_ID
		)
		const spy = jest.spyOn(service, "publishDueScheduled")

		await new ContentScheduleWorker(service, false).runOnce("manual")
		expect(spy).not.toHaveBeenCalled()

		await new ContentScheduleWorker(service, true).runOnce("manual")
		expect(spy).toHaveBeenCalledTimes(1)
		spy.mockRestore()
	})
})
