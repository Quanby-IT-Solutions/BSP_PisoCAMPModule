import { and, eq, sql } from "drizzle-orm"

import {
	assetObjects,
	assets,
	auditLog,
	contentItems,
	contentVersions,
	relatedLinks,
	versionAssets,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

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

const ACTOR_ID = "cm1-task4-actor"
const OTHER_ID = "cm1-task4-other"
const REQUEST_ID = "2a8748ad-fbde-4b77-981c-64cf410fb3b5"

const advisory = (title = "Flood advisory") => ({
	contentType: "advisory" as const,
	title,
	summary: "Safety reminder",
	body: "Keep banknotes clean and dry.",
})

const link = (targetContentItemId: string) => ({
	kind: "topic" as const,
	label: "Related topic",
	targetContentItemId,
})

describe("ContentService", () => {
	let service: ContentService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(
			sql`truncate table version_asset, asset, asset_object, related_link, content_version, content_item, audit_log, idempotency_keys, users restart identity cascade`
		)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ACTOR_ID}, 'Content Editor', 'editor@example.test', true, now(), now()),
			       (${OTHER_ID}, 'Other Editor', 'other@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(
			sql`truncate table version_asset, asset, asset_object, related_link, content_version, content_item, audit_log, idempotency_keys restart identity cascade`
		)
		service = new ContentService(new AuditService())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("creates the complete draft aggregate and bounded audit atomically", async () => {
		const target = await service.create(
			{ requestId: REQUEST_ID, content: advisory("Target"), relatedLinks: [] },
			ACTOR_ID
		)
		const result = await service.create(
			{
				requestId: "6a6f5778-42fc-4e11-a7cb-f8e7bda68fd4",
				content: advisory(),
				relatedLinks: [link(target.id)],
			},
			ACTOR_ID
		)

		expect(result).toMatchObject({
			contentType: "advisory",
			status: "draft",
			creator: { id: ACTOR_ID, name: "Content Editor" },
			lastEditor: { id: ACTOR_ID, name: "Content Editor" },
			currentVersion: { versionNo: 1, status: "draft", content: advisory() },
		})
		expect(result.id).not.toBe(result.currentVersion.id)
		expect(result.currentVersion.relatedLinks[0]).toMatchObject({
			kind: "topic",
			position: 0,
			targetContentItemId: target.id,
		})
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, result.id))
		expect(item?.currentWorkingVersionId).toBe(result.currentVersion.id)
		const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, result.id))
		expect(audits).toHaveLength(1)
		expect(audits[0]).toMatchObject({
			domain: "content",
			action: "content.create",
			actorId: ACTOR_ID,
		})
		expect(JSON.stringify(audits[0])).not.toContain(advisory().body)
	})

	it("locks and appends edits while preserving prior version and links byte-for-byte", async () => {
		const target = await service.create(
			{ requestId: REQUEST_ID, content: advisory("Target"), relatedLinks: [] },
			ACTOR_ID
		)
		const created = await service.create(
			{
				requestId: "71252331-1bde-459f-886f-a34a403c692c",
				content: advisory(),
				relatedLinks: [link(target.id)],
			},
			ACTOR_ID
		)
		const oldVersion = await db
			.select()
			.from(contentVersions)
			.where(eq(contentVersions.id, created.currentVersion.id))
		const oldLinks = await db
			.select()
			.from(relatedLinks)
			.where(eq(relatedLinks.contentVersionId, created.currentVersion.id))
		const oldDate = new Date("2000-01-01T00:00:00.000Z")
		await db.update(contentItems).set({ updatedAt: oldDate }).where(eq(contentItems.id, created.id))

		const updated = await service.update(
			{
				itemId: created.id,
				requestId: "5814180e-6dc5-4676-8307-4bd2844d384e",
				expectedVersionNo: 1,
				content: { ...advisory("Updated advisory"), summary: "Updated summary" },
				relatedLinks: [],
			},
			OTHER_ID
		)

		expect(updated.currentVersion.versionNo).toBe(2)
		expect(updated.currentVersion.id).not.toBe(created.currentVersion.id)
		expect(updated.lastEditor).toEqual({ id: OTHER_ID, name: "Other Editor" })
		expect(new Date(updated.dateModified).getTime()).toBeGreaterThan(oldDate.getTime())
		const [persistedItem] = await db
			.select()
			.from(contentItems)
			.where(eq(contentItems.id, created.id))
		expect(persistedItem?.updatedAt.toISOString()).toBe(updated.dateModified)
		expect(
			await db
				.select()
				.from(contentVersions)
				.where(eq(contentVersions.id, created.currentVersion.id))
		).toEqual(oldVersion)
		expect(
			await db
				.select()
				.from(relatedLinks)
				.where(eq(relatedLinks.contentVersionId, created.currentVersion.id))
		).toEqual(oldLinks)
		const editAudits = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.targetId, created.id), eq(auditLog.action, "content.edit")))
		expect(editAudits).toHaveLength(1)
		const [editAudit] = editAudits
		expect(editAudit?.newValue).toMatchObject({
			versionNo: 2,
			contentType: "advisory",
			changedFields: ["relatedLinks", "summary", "title"],
		})
		expect(JSON.stringify(editAudit)).not.toContain("Updated summary")
	})

	it("starts new content without attachments and copies exact asset identities through edits", async () => {
		const created = await service.create(
			{ requestId: REQUEST_ID, content: advisory(), relatedLinks: [] },
			ACTOR_ID
		)
		expect(
			await db
				.select()
				.from(versionAssets)
				.where(eq(versionAssets.contentVersionId, created.currentVersion.id))
		).toHaveLength(0)
		const assetId = crypto.randomUUID()
		const sha256 = "a".repeat(64)
		await db.insert(assetObjects).values({
			sha256,
			byteLength: 1,
			mediaType: "image/png",
			body: Buffer.from([0]),
		})
		await db.insert(assets).values({
			id: assetId,
			contentItemId: created.id,
			sha256,
			byteLength: 1,
			mediaType: "image/png",
			uploadedBy: ACTOR_ID,
		})
		await db.insert(versionAssets).values({
			contentItemId: created.id,
			contentVersionId: created.currentVersion.id,
			assetId,
			role: "obverse",
		})

		const updated = await service.update(
			{
				itemId: created.id,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 1,
				content: advisory("Edited with attachment"),
				relatedLinks: [],
			},
			OTHER_ID
		)
		const references = await db
			.select({
				versionId: versionAssets.contentVersionId,
				role: versionAssets.role,
				assetId: versionAssets.assetId,
			})
			.from(versionAssets)
			.where(eq(versionAssets.contentItemId, created.id))
		expect(references).toEqual(
			expect.arrayContaining([
				{ versionId: created.currentVersion.id, role: "obverse", assetId },
				{ versionId: updated.currentVersion.id, role: "obverse", assetId },
			])
		)
	})

	it("rejects stale and non-draft edits without version or audit rows", async () => {
		const created = await service.create(
			{ requestId: REQUEST_ID, content: advisory(), relatedLinks: [] },
			ACTOR_ID
		)
		const beforeVersions = await db.select().from(contentVersions)
		const beforeAudits = await db.select().from(auditLog)
		await expect(
			service.update(
				{
					itemId: created.id,
					requestId: "b973f48e-201d-468c-82c0-e65820c51200",
					expectedVersionNo: 9,
					content: advisory("Stale"),
					relatedLinks: [],
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(await db.select().from(contentVersions)).toEqual(beforeVersions)
		expect(await db.select().from(auditLog)).toEqual(beforeAudits)

		await db
			.update(contentItems)
			.set({ status: "submitted_for_review" })
			.where(eq(contentItems.id, created.id))
		await expect(
			service.update(
				{
					itemId: created.id,
					requestId: "c62df63d-c97a-420c-84ce-59dd9b2786f3",
					expectedVersionNo: 1,
					content: advisory("Late"),
					relatedLinks: [],
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
	})

	it("returns understandable bad requests for catalog and topic-target failures", async () => {
		const baselineItems = await db.select().from(contentItems)
		const baselineVersions = await db.select().from(contentVersions)
		const baselineAudits = await db.select().from(auditLog)
		await expect(
			service.create(
				{
					requestId: "a6e79966-a48d-4011-b504-eb15e59f6169",
					content: {
						contentType: "banknote",
						title: "Mismatched note",
						summary: "Known denomination in the wrong series",
						body: "Body",
						seriesCode: "fpp-banknotes",
						denominationCode: "php-20",
					},
					relatedLinks: [],
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Unknown or mismatched currency series and denomination",
		})
		expect(await db.select().from(contentItems)).toEqual(baselineItems)
		expect(await db.select().from(contentVersions)).toEqual(baselineVersions)
		expect(await db.select().from(auditLog)).toEqual(baselineAudits)

		await expect(
			service.create(
				{
					requestId: REQUEST_ID,
					content: {
						contentType: "banknote",
						title: "Unknown note",
						summary: "Unknown pair",
						body: "Body",
						seriesCode: "ngc-banknotes",
						denominationCode: "php-999",
					},
					relatedLinks: [],
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		await expect(
			service.create(
				{
					requestId: "a020a7c0-c74e-49c2-a0bc-4a75bf9d37d6",
					content: advisory(),
					relatedLinks: [link("7d0337e0-908b-42eb-8943-6a7e16c87576")],
				},
				ACTOR_ID
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
	})

	it("rolls back the aggregate when audit persistence fails", async () => {
		const failingAudit = { record: jest.fn().mockRejectedValue(new Error("audit unavailable")) }
		service = new ContentService(failingAudit as unknown as AuditService)
		await expect(
			service.create({ requestId: REQUEST_ID, content: advisory(), relatedLinks: [] }, ACTOR_ID)
		).rejects.toThrow("audit unavailable")
		expect(await db.select().from(contentItems)).toHaveLength(0)
		expect(await db.select().from(contentVersions)).toHaveLength(0)
	})

	it("lists stable pages with totals and applies status and currency filters", async () => {
		const first = await service.create(
			{ requestId: REQUEST_ID, content: advisory("Alpha advisory"), relatedLinks: [] },
			ACTOR_ID
		)
		const second = await service.create(
			{
				requestId: "8dbbe379-d11c-4b3c-884f-f3dc2927778a",
				content: advisory("Alpha advisory second"),
				relatedLinks: [],
			},
			ACTOR_ID
		)
		const tiedAt = new Date("2020-01-01T00:00:00.000Z")
		await db.update(contentItems).set({ updatedAt: tiedAt }).where(eq(contentItems.id, first.id))
		await db.update(contentItems).set({ updatedAt: tiedAt }).where(eq(contentItems.id, second.id))
		const expectedOrder = [first.id, second.id].sort()
		const pageOne = await service.list({
			page: 1,
			limit: 1,
			contentType: "advisory",
			search: "Alpha",
		})
		const pageTwo = await service.list({
			page: 2,
			limit: 1,
			contentType: "advisory",
			search: "Alpha",
		})
		expect(pageOne.total).toBe(2)
		expect(pageTwo.total).toBe(2)
		expect([pageOne.items[0]?.id, pageTwo.items[0]?.id]).toEqual(expectedOrder)
		expect(JSON.stringify([...pageOne.items, ...pageTwo.items])).not.toMatch(/Body|example\.test/)

		await db
			.update(contentItems)
			.set({ status: "submitted_for_review" })
			.where(eq(contentItems.id, second.id))
		expect(
			(await service.list({ page: 1, limit: 20, status: "draft" })).items.map(item => item.id)
		).toContain(first.id)
		expect(
			(await service.list({ page: 1, limit: 20, status: "submitted_for_review" })).items.map(
				item => item.id
			)
		).toEqual([second.id])

		const fpp = await service.create(
			{
				requestId: "23f250b4-7a2b-4636-876b-55c586cc0705",
				content: {
					contentType: "banknote",
					title: "Polymer fifty",
					summary: "FPP banknote",
					body: "Body",
					seriesCode: "fpp-banknotes",
					denominationCode: "php-50",
				},
				relatedLinks: [],
			},
			ACTOR_ID
		)
		const ngc = await service.create(
			{
				requestId: "bbca83fd-3947-4c8e-b37e-3eb94f71a8c3",
				content: {
					contentType: "banknote",
					title: "NGC twenty",
					summary: "NGC banknote",
					body: "Body",
					seriesCode: "ngc-banknotes",
					denominationCode: "php-20",
				},
				relatedLinks: [],
			},
			ACTOR_ID
		)
		expect(
			(await service.list({ page: 1, limit: 20, seriesCode: "fpp-banknotes" })).items.map(
				item => item.id
			)
		).toEqual([fpp.id])
		expect(
			(await service.list({ page: 1, limit: 20, denominationCode: "php-20" })).items.map(
				item => item.id
			)
		).toEqual([ngc.id])

		const detail = await service.get(first.id)
		expect(Object.keys(detail).sort()).toEqual(
			[
				"contentType",
				"createdAt",
				"creator",
				"currentVersion",
				"dateModified",
				"id",
				"lastEditor",
				"status",
			].sort()
		)
	})

	it("uses literal full-text terms and returns no matches for punctuation-only search", async () => {
		const literal = await service.create(
			{
				requestId: REQUEST_ID,
				content: advisory("Rate 100%_safe"),
				relatedLinks: [],
			},
			ACTOR_ID
		)
		await service.create(
			{
				requestId: "08204b82-41a3-4e4f-85ac-ae10ed282cd5",
				content: advisory("Rate 100Xsafe"),
				relatedLinks: [],
			},
			ACTOR_ID
		)
		const result = await service.list({ page: 1, limit: 20, search: "100%_safe" })
		expect(result.total).toBe(1)
		expect(result.items.map(item => item.id)).toEqual([literal.id])

		const punctuationOnly = await service.list({ page: 1, limit: 20, search: "%_" })
		expect(punctuationOnly).toMatchObject({ total: 0, items: [] })
	})
})
