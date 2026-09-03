import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import { arExperienceDetails, contentVersions, versionAssets } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

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

const EDITOR_ID = "ar2-editor"
const APPROVER_ID = "ar2-approver"

const SERIES = "ngc-coins"
const DENOMINATION = "php-20"

function correlation(itemId: string, expectedVersionNo: number, comments?: string) {
	return {
		itemId,
		requestId: randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	} as never
}

const experience = (overrides: Record<string, unknown> = {}) =>
	({
		contentType: "ar_experience" as const,
		title: "20-piso coin in augmented reality",
		summary: "Place the NGC 20-piso coin on any surface and turn it.",
		body: "Point the camera at a flat surface, then tap to place the coin.",
		seriesCode: SERIES,
		denominationCode: DENOMINATION,
		deviceRequirement: { minimumAndroidSdk: 26, minimumIosVersion: "13.0" },
		animationDurationMs: 12_000,
		...overrides,
	}) as never

/**
 * AR-2. The admin side of an AR experience: what it is of, what a device needs
 * to run it, and the assets it cannot be reviewed without.
 */
describe("AR-2 AR experience content admin", () => {
	let content: ContentService
	let workflow: ContentWorkflowService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table ar_experience_detail, version_asset, asset, asset_object,
				related_link, content_version, content_item, audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'AR2 Editor', 'ar2-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'AR2 Approver', 'ar2-approver@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table ar_experience_detail, version_asset, asset, asset_object,
				related_link, content_version, content_item, audit_log, idempotency_keys
			restart identity cascade
		`)
		const audit = new AuditService()
		content = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	/** One stored asset, attached to a version in the role AR-2 requires. */
	async function attachAsset(
		itemId: string,
		versionId: string,
		role: "ar_model" | "animation" | "audio"
	) {
		const mediaType =
			role === "audio" ? "audio/mpeg" : role === "animation" ? "model/gltf+json" : "model/gltf-binary"
		const sha256 = randomUUID().replaceAll("-", "").padEnd(64, "0")
		const assetId = randomUUID()
		await db.execute(sql`
			insert into asset_object (sha256, byte_length, media_type, body)
			values (${sha256}, 4, ${mediaType}, decode('00010203', 'hex'))
		`)
		await db.execute(sql`
			insert into asset (id, content_item_id, sha256, byte_length, media_type, uploaded_by)
			values (${assetId}, ${itemId}, ${sha256}, 4, ${mediaType}, ${EDITOR_ID})
		`)
		await db.insert(versionAssets).values({
			contentItemId: itemId,
			contentVersionId: versionId,
			assetId,
			role,
		})
	}

	async function draft(overrides: Record<string, unknown> = {}) {
		const created = await content.create(
			{ requestId: randomUUID(), content: experience(overrides), relatedLinks: [] },
			EDITOR_ID
		)
		const [version] = await db
			.select()
			.from(contentVersions)
			.where(eq(contentVersions.itemId, created.id))
		return { itemId: created.id, versionId: version!.id }
	}

	describe("AC1 — an experience saves as a draft with its denomination and requirements", () => {
		it("stores the child row beside the version", async () => {
			const { itemId, versionId } = await draft()

			const [detail] = await db
				.select()
				.from(arExperienceDetails)
				.where(eq(arExperienceDetails.contentVersionId, versionId))
			expect(detail).toMatchObject({
				contentItemId: itemId,
				seriesCode: SERIES,
				denominationCode: DENOMINATION,
				minimumAndroidSdk: 26,
				minimumIosVersion: "13.0",
				animationDurationMs: 12_000,
			})

			const stored = await content.get(itemId)
			expect(stored.status).toBe("draft")
			expect(stored.currentVersion.content).toMatchObject({
				contentType: "ar_experience",
				deviceRequirement: { minimumAndroidSdk: 26, minimumIosVersion: "13.0" },
				animationDurationMs: 12_000,
			})
		})

		it("accepts an experience for one platform only", async () => {
			const { versionId } = await draft({
				deviceRequirement: { minimumAndroidSdk: 26, minimumIosVersion: null },
			})

			const [detail] = await db
				.select()
				.from(arExperienceDetails)
				.where(eq(arExperienceDetails.contentVersionId, versionId))
			expect(detail).toMatchObject({ minimumAndroidSdk: 26, minimumIosVersion: null })
		})

		it("refuses a denomination that does not exist", async () => {
			await expect(
				content.create(
					{
						requestId: randomUUID(),
						content: experience({ denominationCode: "php-999" }),
						relatedLinks: [],
					},
					EDITOR_ID
				)
			).rejects.toMatchObject({ message: expect.stringContaining("currency series") })
		})

		it("lists the experience with what a device needs", async () => {
			await draft()

			const listed = await content.list({ page: 1, limit: 20 } as never)
			const summary = listed.items.find(item => item.contentType === "ar_experience")
			expect(summary).toMatchObject({
				seriesCode: SERIES,
				denominationCode: DENOMINATION,
				minimumAndroidSdk: 26,
				minimumIosVersion: "13.0",
			})
		})
	})

	describe("AC2 — a missing mandatory asset blocks submission", () => {
		it("refuses the submission and names what is missing", async () => {
			const { itemId } = await draft()

			await expect(
				workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: expect.stringContaining("ar_model"),
			})
		})

		it("still refuses when only some of the three are attached", async () => {
			const { itemId, versionId } = await draft()
			await attachAsset(itemId, versionId, "ar_model")
			await attachAsset(itemId, versionId, "animation")

			// The narration is what an experience says; an approver reviewing a
			// silent one is reviewing something else.
			await expect(
				workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)
			).rejects.toMatchObject({ message: expect.stringContaining("audio") })
		})

		it("allows the submission once all three are attached", async () => {
			const { itemId, versionId } = await draft()
			await attachAsset(itemId, versionId, "ar_model")
			await attachAsset(itemId, versionId, "animation")
			await attachAsset(itemId, versionId, "audio")

			await workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)

			const stored = await content.get(itemId)
			expect(stored.status).toBe("submitted_for_review")
		})

		it("leaves other content types alone", async () => {
			// The rule is about AR experiences; an advisory has no assets to miss.
			const created = await content.create(
				{
					requestId: randomUUID(),
					content: {
						contentType: "advisory",
						title: "Handle banknotes with care",
						summary: "Approved advisory copy.",
						body: "Do not fold, staple or write on Philippine banknotes.",
					} as never,
					relatedLinks: [],
				},
				EDITOR_ID
			)

			await workflow.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)

			expect((await content.get(created.id)).status).toBe("submitted_for_review")
		})
	})

	describe("AC3 — CM-3's workflow rules apply unchanged", () => {
		it("carries the experience through review to publication", async () => {
			const { itemId, versionId } = await draft()
			await attachAsset(itemId, versionId, "ar_model")
			await attachAsset(itemId, versionId, "animation")
			await attachAsset(itemId, versionId, "audio")

			await workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)
			await workflow.transition("approve", correlation(itemId, 2, "Checked"), APPROVER_ID)
			await workflow.transition("publish", correlation(itemId, 3), APPROVER_ID)

			const published = await content.get(itemId)
			expect(published.status).toBe("published")
			// The child row is copied forward with the version, like every other
			// content type's is.
			const [detail] = await db
				.select()
				.from(arExperienceDetails)
				.where(eq(arExperienceDetails.contentVersionId, published.currentVersion.id))
			expect(detail).toMatchObject({ denominationCode: DENOMINATION })
		})

		it("refuses a transition that names a stale version", async () => {
			const { itemId, versionId } = await draft()
			await attachAsset(itemId, versionId, "ar_model")
			await attachAsset(itemId, versionId, "animation")
			await attachAsset(itemId, versionId, "audio")
			await workflow.transition("submit", correlation(itemId, 1, "Ready"), EDITOR_ID)

			// CM-3's optimistic concurrency is not relaxed for a new content
			// type: approving the version you read is the whole point of naming
			// it.
			await expect(
				workflow.transition("approve", correlation(itemId, 1, "Fine"), APPROVER_ID)
			).rejects.toMatchObject({ code: "CONFLICT" })
		})

		it("refuses a transition the lifecycle does not allow", async () => {
			const { itemId } = await draft()

			// Publishing a draft skips review altogether.
			await expect(
				workflow.transition("publish", correlation(itemId, 1), APPROVER_ID)
			).rejects.toMatchObject({ code: "CONFLICT" })
		})
	})
})
