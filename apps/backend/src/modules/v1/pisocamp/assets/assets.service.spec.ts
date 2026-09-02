import { createHash, randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"

import {
	assetObjects,
	assets,
	auditLog,
	contentItems,
	contentVersions,
	versionAssets,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"
import type { PreparedAssetUpload } from "./asset-file-policy"
import { PostgresAssetObjectStore } from "./asset-object-store"
import { AssetsService } from "./assets.service"

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

const ACTOR_ID = "cm2-task5-actor"
const OTHER_ID = "cm2-task5-other"

const advisory = (title = "Asset lifecycle") => ({
	contentType: "advisory" as const,
	title,
	summary: "Immutable attachment snapshots",
	body: "Only safe metadata belongs in asset audit records.",
})

const prepared = (
	mediaType: PreparedAssetUpload["mediaType"] = "model/gltf+json",
	label: string = randomUUID()
): PreparedAssetUpload => {
	const bytes = Buffer.from(`cm2-task5-${label}`, "utf8")
	return {
		bytes,
		byteLength: bytes.length,
		file: new File([bytes], "asset", { type: mediaType }),
		mediaType,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	}
}

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>(resolvePromise => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

async function waitForBlockedContentItemLocks(minimum: number) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const result = await db.execute<{ pid: number }>(sql`
			select pid
			from pg_stat_activity
			where datname = current_database()
			  and pid <> pg_backend_pid()
			  and wait_event_type = 'Lock'
			  and position('"content_item"' in query) > 0
		`)
		if (result.rows.length >= minimum) return result.rows.map(row => row.pid)
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	throw new Error(`Timed out waiting for ${minimum} blocked content-item lock queries`)
}

describe("AssetsService", () => {
	let audit: AuditService
	let content: ContentService
	let service: AssetsService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table version_asset, asset, asset_object, related_link, content_version,
				content_item, audit_log, idempotency_keys, users restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ACTOR_ID}, 'Asset Editor', 'cm2-task5-actor@example.test', true, now(), now()),
			       (${OTHER_ID}, 'Other Editor', 'cm2-task5-other@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table version_asset, asset, asset_object, related_link, content_version,
				content_item, audit_log, idempotency_keys restart identity cascade
		`)
		audit = new AuditService()
		content = new ContentService(audit)
		service = new AssetsService(audit, new PostgresAssetObjectStore())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	const draft = (title?: string) =>
		content.create(
			{ requestId: randomUUID(), content: advisory(title), relatedLinks: [] },
			ACTOR_ID
		)

	it("uploads, detaches, reattaches, and deletes through immutable snapshots", async () => {
		const created = await draft()
		const uploadBytes = prepared()
		const uploaded = await service.upload(
			uploadBytes,
			{
				file: uploadBytes.file,
				itemId: created.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		expect(uploaded).toMatchObject({
			currentVersionNo: 2,
			asset: {
				contentItemId: created.id,
				sha256: uploadBytes.sha256,
				mediaType: "model/gltf+json",
				version: 1,
			},
			attachments: [{ role: "animation", asset: { sha256: uploadBytes.sha256 } }],
		})
		const detached = await service.detach(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 2,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		expect(detached).toMatchObject({ currentVersionNo: 3, attachments: [] })
		const attached = await service.attach(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 3,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		expect(attached).toMatchObject({
			currentVersionNo: 4,
			attachments: [{ role: "animation", asset: { id: uploaded.asset.id } }],
		})
		const deleted = await service.delete(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 4,
				requestId: randomUUID(),
			},
			OTHER_ID
		)
		expect(deleted).toMatchObject({ currentVersionNo: 5, attachments: [] })

		const rows = await db
			.select()
			.from(versionAssets)
			.where(eq(versionAssets.contentItemId, created.id))
		expect(rows.map(row => row.assetId)).toEqual([uploaded.asset.id, uploaded.asset.id])
		expect(rows.map(row => row.contentVersionId).sort()).toEqual(
			[uploaded.currentVersionId, attached.currentVersionId].sort()
		)
		expect(await db.select().from(assetObjects)).toHaveLength(1)
		expect((await db.select().from(assets))[0]).toMatchObject({
			id: uploaded.asset.id,
			deletedBy: OTHER_ID,
		})
	})

	it("advances one immutable snapshot when deleting an unattached asset", async () => {
		const created = await draft()
		const bytes = prepared("image/png", "unattached-delete")
		const uploaded = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: created.id,
				expectedVersionNo: 1,
				role: "obverse",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		const detached = await service.detach(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 2,
				role: "obverse",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)

		const deleted = await service.delete(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 3,
				requestId: randomUUID(),
			},
			OTHER_ID
		)

		expect(detached.attachments).toEqual([])
		expect(deleted).toMatchObject({ currentVersionNo: 4, attachments: [] })
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(4)
	})

	it("removes a deleted asset from every current role while preserving historical references", async () => {
		const created = await draft()
		const bytes = prepared("image/png", "multi-role-delete")
		const uploaded = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: created.id,
				expectedVersionNo: 1,
				role: "obverse",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		const attached = await service.attach(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 2,
				role: "reverse",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		expect(attached.attachments.map(row => row.role)).toEqual(["obverse", "reverse"])

		const deleted = await service.delete(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 3,
				requestId: randomUUID(),
			},
			OTHER_ID
		)
		expect(deleted).toMatchObject({ currentVersionNo: 4, attachments: [] })

		const rows = await db
			.select()
			.from(versionAssets)
			.where(eq(versionAssets.assetId, uploaded.asset.id))
		expect(rows).toHaveLength(3)
		expect(rows.map(row => row.contentVersionId).sort()).toEqual(
			[uploaded.currentVersionId, attached.currentVersionId, attached.currentVersionId].sort()
		)
		expect(rows.some(row => row.contentVersionId === deleted.currentVersionId)).toBe(false)
	})

	it("rejects reattaching a deleted asset at the post-delete version without side effects", async () => {
		const created = await draft()
		const bytes = prepared("model/gltf+json", "deleted-reattach")
		const uploaded = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: created.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		const deleted = await service.delete(
			{
				assetId: uploaded.asset.id,
				itemId: created.id,
				expectedVersionNo: 2,
				requestId: randomUUID(),
			},
			OTHER_ID
		)
		const beforeVersions = await db
			.select()
			.from(contentVersions)
			.where(eq(contentVersions.itemId, created.id))
		const beforeAttachments = await db
			.select()
			.from(versionAssets)
			.where(eq(versionAssets.contentItemId, created.id))
		const beforeAudits = await db.select().from(auditLog)

		await expect(
			service.attach(
				{
					assetId: uploaded.asset.id,
					itemId: created.id,
					expectedVersionNo: deleted.currentVersionNo,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT", message: "Asset is deleted" })

		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toEqual(beforeVersions)
		expect(
			await db.select().from(versionAssets).where(eq(versionAssets.contentItemId, created.id))
		).toEqual(beforeAttachments)
		expect(await db.select().from(auditLog)).toEqual(beforeAudits)
	})

	it("deduplicates objects while keeping asset identities item-scoped", async () => {
		const first = await draft("First")
		const second = await draft("Second")
		const bytes = prepared()
		const firstResult = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: first.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		const secondResult = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: second.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		expect(firstResult.asset.id).not.toBe(secondResult.asset.id)
		expect(firstResult.asset.sha256).toBe(secondResult.asset.sha256)
		expect(await db.select().from(assetObjects)).toHaveLength(1)
		expect(await db.select().from(assets)).toHaveLength(2)
	})

	it("rejects stale, occupied-role, non-draft, wrong-kind, cross-item, and deleted attachment changes", async () => {
		const first = await draft("First")
		const second = await draft("Second")
		const model = prepared()
		const uploaded = await service.upload(
			model,
			{
				file: model.file,
				itemId: first.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		await expect(
			service.upload(
				prepared(),
				{
					file: model.file,
					itemId: first.id,
					expectedVersionNo: 2,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
		await expect(
			service.detach(
				{
					assetId: uploaded.asset.id,
					itemId: first.id,
					expectedVersionNo: 1,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
		await expect(
			service.attach(
				{
					assetId: uploaded.asset.id,
					itemId: second.id,
					expectedVersionNo: 1,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
		await service.detach(
			{
				assetId: uploaded.asset.id,
				itemId: first.id,
				expectedVersionNo: 2,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		await expect(
			service.attach(
				{
					assetId: uploaded.asset.id,
					itemId: first.id,
					expectedVersionNo: 3,
					role: "obverse",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		await service.delete(
			{
				assetId: uploaded.asset.id,
				itemId: first.id,
				expectedVersionNo: 3,
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		await expect(
			service.attach(
				{
					assetId: uploaded.asset.id,
					itemId: first.id,
					expectedVersionNo: 3,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
		await db
			.update(contentItems)
			.set({ status: "submitted_for_review" })
			.where(eq(contentItems.id, first.id))
		await expect(service.list(first.id)).resolves.toBeDefined()
		await expect(
			service.upload(
				prepared(),
				{
					file: model.file,
					itemId: first.id,
					expectedVersionNo: 3,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
	})

	it("returns the published-reference conflict before any tombstone or snapshot mutation", async () => {
		const created = await draft()
		const bytes = prepared()
		const uploaded = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: created.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		const source = (
			await db
				.select()
				.from(contentVersions)
				.where(eq(contentVersions.id, uploaded.currentVersionId))
		)[0]!
		const publishedVersionId = randomUUID()
		const publishedAt = new Date()
		await db.insert(contentVersions).values({
			id: publishedVersionId,
			itemId: source.itemId,
			versionNo: source.versionNo + 1,
			parentVersionId: source.id,
			status: "published",
			contentType: source.contentType,
			title: source.title,
			summary: source.summary,
			body: source.body,
			seriesCode: source.seriesCode,
			denominationCode: source.denominationCode,
			primaryUrl: source.primaryUrl,
			createdBy: ACTOR_ID,
			approvedBy: ACTOR_ID,
			approvedAt: publishedAt,
			publishedBy: ACTOR_ID,
			publishedAt,
			transitionAction: "publish",
		})
		await db.insert(versionAssets).values({
			contentItemId: created.id,
			contentVersionId: publishedVersionId,
			assetId: uploaded.asset.id,
			role: "animation",
		})
		const beforeVersions = await db.select().from(contentVersions)
		const beforeAsset = (await db.select().from(assets).where(eq(assets.id, uploaded.asset.id)))[0]
		const beforeAudits = await db.select().from(auditLog)
		await expect(
			service.delete(
				{
					assetId: uploaded.asset.id,
					itemId: created.id,
					expectedVersionNo: 999,
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Published content references this asset",
		})
		expect(await db.select().from(contentVersions)).toEqual(beforeVersions)
		expect((await db.select().from(assets).where(eq(assets.id, uploaded.asset.id)))[0]).toEqual(
			beforeAsset
		)
		expect(await db.select().from(auditLog)).toEqual(beforeAudits)
	})

	it("serializes concurrent writers so exactly one expected-version mutation commits", async () => {
		const created = await draft()
		const [first, second] = await Promise.allSettled([
			service.upload(
				prepared("image/png", "first"),
				{
					file: new File(["first"], "asset"),
					itemId: created.id,
					expectedVersionNo: 1,
					role: "obverse",
					requestId: randomUUID(),
				},
				ACTOR_ID
			),
			service.upload(
				prepared("image/jpeg", "second"),
				{
					file: new File(["second"], "asset"),
					itemId: created.id,
					expectedVersionNo: 1,
					role: "reverse",
					requestId: randomUUID(),
				},
				OTHER_ID
			),
		])
		expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"])
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(2)
		expect(await db.select().from(assets).where(eq(assets.contentItemId, created.id))).toHaveLength(
			1
		)
		expect(await db.select().from(assetObjects)).toHaveLength(1)
	})

	it.each(["attach", "edit", "workflow"] as const)(
		"serializes %s ahead of delete without an inverse-order deadlock",
		async contenderKind => {
			const created = await draft(`Lock order ${contenderKind}`)
			const bytes = prepared("image/png", `lock-order-${contenderKind}`)
			const uploaded = await service.upload(
				bytes,
				{
					file: bytes.file,
					itemId: created.id,
					expectedVersionNo: 1,
					role: "obverse",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
			let expectedVersionNo = 2
			if (contenderKind === "attach") {
				await service.detach(
					{
						assetId: uploaded.asset.id,
						itemId: created.id,
						expectedVersionNo,
						role: "obverse",
						requestId: randomUUID(),
					},
					ACTOR_ID
				)
				expectedVersionNo = 3
			}

			const itemLocked = deferred()
			const releaseItem = deferred()
			const blocker = db.transaction(async tx => {
				await tx
					.select({ id: contentItems.id })
					.from(contentItems)
					.where(eq(contentItems.id, created.id))
					.for("update")
				itemLocked.resolve()
				await releaseItem.promise
			})
			await itemLocked.promise

			const contender =
				contenderKind === "attach"
					? service.attach(
							{
								assetId: uploaded.asset.id,
								itemId: created.id,
								expectedVersionNo,
								role: "reverse",
								requestId: randomUUID(),
							},
							ACTOR_ID
						)
					: contenderKind === "edit"
						? content.update(
								{
									itemId: created.id,
									expectedVersionNo,
									requestId: randomUUID(),
									content: advisory("Edit wins lock order"),
									relatedLinks: [],
								},
								ACTOR_ID
							)
						: new ContentWorkflowService(audit).transition(
								"submit",
								{
									itemId: created.id,
									expectedVersionNo,
									requestId: randomUUID(),
								},
								ACTOR_ID
							)
			await waitForBlockedContentItemLocks(1)

			const deletion = service.delete(
				{
					assetId: uploaded.asset.id,
					itemId: created.id,
					expectedVersionNo,
					requestId: randomUUID(),
				},
				OTHER_ID
			)
			await waitForBlockedContentItemLocks(2)
			releaseItem.resolve()
			await blocker

			const [contenderResult, deleteResult] = await Promise.allSettled([contender, deletion])
			expect(contenderResult.status).toBe("fulfilled")
			expect(deleteResult.status).toBe("rejected")
			if (deleteResult.status === "rejected") {
				expect(deleteResult.reason).toMatchObject({ code: "CONFLICT" })
				expect(deleteResult.reason).not.toMatchObject({ code: "40P01" })
			}
			expect(
				await db.select().from(auditLog).where(eq(auditLog.action, "content.asset.delete"))
			).toHaveLength(0)
		}
	)

	it("rolls back object, asset, snapshot, attachment, and success audit when audit persistence fails", async () => {
		const created = await draft()
		const failingAudit = { record: jest.fn().mockRejectedValue(new Error("audit unavailable")) }
		service = new AssetsService(
			failingAudit as unknown as AuditService,
			new PostgresAssetObjectStore()
		)
		const bytes = prepared()
		await expect(
			service.upload(
				bytes,
				{
					file: bytes.file,
					itemId: created.id,
					expectedVersionNo: 1,
					role: "animation",
					requestId: randomUUID(),
				},
				ACTOR_ID
			)
		).rejects.toThrow("audit unavailable")
		expect(await db.select().from(assetObjects)).toHaveLength(0)
		expect(await db.select().from(assets)).toHaveLength(0)
		expect(await db.select().from(versionAssets)).toHaveLength(0)
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(1)
		expect(
			await db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.targetId, created.id), eq(auditLog.action, "content.asset.upload")))
		).toHaveLength(0)
	})

	it("stores only bounded metadata in asset audits", async () => {
		const created = await draft()
		const bytes = prepared("model/gltf+json", "audit-secret-body")
		const uploaded = await service.upload(
			bytes,
			{
				file: bytes.file,
				itemId: created.id,
				expectedVersionNo: 1,
				role: "animation",
				requestId: randomUUID(),
			},
			ACTOR_ID
		)
		const rows = await db
			.select()
			.from(auditLog)
			.where(
				and(eq(auditLog.targetId, uploaded.asset.id), eq(auditLog.action, "content.asset.upload"))
			)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.newValue).toMatchObject({
			assetId: uploaded.asset.id,
			itemId: created.id,
			role: "animation",
			sha256: bytes.sha256,
			mediaType: bytes.mediaType,
			byteLength: bytes.byteLength,
		})
		const serialized = JSON.stringify(rows[0])
		expect(serialized).not.toContain("audit-secret-body")
		expect(serialized).not.toMatch(/filename|originalname|temporary|\\\\|\/tmp\//i)
	})
})
