import { createHash, randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"

import {
	assetObjects,
	assets,
	auditLog,
	contentVersions,
	idempotencyKeys,
	versionAssets,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentService } from "../content/content.service"
import type { PreparedAssetUpload } from "./asset-file-policy"
import { PostgresAssetObjectStore } from "./asset-object-store"
import { AssetsService } from "./assets.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const ACTOR_ID = "cm2-task5-idempotency-actor"
const RESPONSE_TRIGGER = "cm2_task5_reject_idempotency_response"
const RESPONSE_FUNCTION = "cm2_task5_reject_idempotency_response_fn"

const advisory = (title: string) => ({
	contentType: "advisory" as const,
	title,
	summary: "Real PostgreSQL idempotency propagation",
	body: "The idempotency response and the asset lifecycle share one transaction.",
})

const prepared = (label: string): PreparedAssetUpload => {
	const bytes = Buffer.from(`cm2-task5-idempotency-${label}`, "utf8")
	return {
		bytes,
		byteLength: bytes.length,
		file: new File([bytes], "asset", { type: "model/gltf+json" }),
		mediaType: "model/gltf+json",
		sha256: createHash("sha256").update(bytes).digest("hex"),
	}
}

async function removeResponseFailureTrigger() {
	await db.execute(sql.raw(`drop trigger if exists ${RESPONSE_TRIGGER} on idempotency_keys`))
	await db.execute(sql.raw(`drop function if exists ${RESPONSE_FUNCTION}()`))
}

describe("asset upload idempotency", () => {
	let audit: AuditService
	let content: ContentService
	let assetsService: AssetsService
	let idempotency: IdempotencyService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await removeResponseFailureTrigger()
		await db.execute(sql`
			truncate table version_asset, asset, asset_object, related_link, content_version,
				content_item, audit_log, idempotency_keys, users restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ACTOR_ID}, 'Idempotency Editor', 'cm2-task5-idempotency@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		await removeResponseFailureTrigger()
		await db.execute(sql`
			truncate table version_asset, asset, asset_object, related_link, content_version,
				content_item, audit_log, idempotency_keys restart identity cascade
		`)
		audit = new AuditService()
		content = new ContentService(audit)
		assetsService = new AssetsService(audit, new PostgresAssetObjectStore())
		idempotency = new IdempotencyService()
	})

	afterAll(async () => {
		await removeResponseFailureTrigger()
		await db.$client.end()
	})

	function executeUpload(input: {
		key: string
		itemId: string
		expectedVersionNo: number
		role?: "animation"
		prepared: PreparedAssetUpload
		fingerprintSha256?: string
	}) {
		const role = input.role ?? "animation"
		return idempotency.execute({
			authorId: ACTOR_ID,
			key: input.key,
			method: "POST",
			path: "/api/v1/admin/pisocamp/assets",
			input: {
				fileSha256: input.fingerprintSha256 ?? input.prepared.sha256,
				itemId: input.itemId,
				expectedVersionNo: input.expectedVersionNo,
				role,
				requestId: input.key,
			},
			run: () =>
				assetsService.upload(
					input.prepared,
					{
						file: input.prepared.file,
						itemId: input.itemId,
						expectedVersionNo: input.expectedVersionNo,
						role,
						requestId: input.key,
					},
					ACTOR_ID
				),
		})
	}

	it("returns an identical stored response after response loss with one committed aggregate", async () => {
		const created = await content.create(
			{ requestId: randomUUID(), content: advisory("Lost response"), relatedLinks: [] },
			ACTOR_ID
		)
		const key = randomUUID()
		const bytes = prepared("lost-response")
		const first = await executeUpload({
			key,
			itemId: created.id,
			expectedVersionNo: 1,
			prepared: bytes,
		})

		const retry = await executeUpload({
			key,
			itemId: created.id,
			expectedVersionNo: 1,
			prepared: bytes,
		})

		expect(retry).toEqual(first)
		expect(JSON.stringify(retry)).toBe(JSON.stringify(first))
		expect(await db.select().from(assetObjects)).toHaveLength(1)
		expect(await db.select().from(assets)).toHaveLength(1)
		expect(await db.select().from(versionAssets)).toHaveLength(1)
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(2)
		expect(
			await db.select().from(auditLog).where(eq(auditLog.action, "content.asset.upload"))
		).toHaveLength(1)
		expect(
			await db
				.select()
				.from(idempotencyKeys)
				.where(and(eq(idempotencyKeys.authorId, ACTOR_ID), eq(idempotencyKeys.key, key)))
		).toHaveLength(1)
	})

	it("conflicts on changed digest or input without adding any side effects", async () => {
		const created = await content.create(
			{ requestId: randomUUID(), content: advisory("Fingerprint conflict"), relatedLinks: [] },
			ACTOR_ID
		)
		const key = randomUUID()
		const bytes = prepared("original")
		await executeUpload({ key, itemId: created.id, expectedVersionNo: 1, prepared: bytes })

		await expect(
			executeUpload({
				key,
				itemId: created.id,
				expectedVersionNo: 1,
				prepared: prepared("changed-digest"),
			})
		).rejects.toMatchObject({ code: "CONFLICT" })
		await expect(
			executeUpload({
				key,
				itemId: created.id,
				expectedVersionNo: 2,
				prepared: bytes,
			})
		).rejects.toMatchObject({ code: "CONFLICT" })

		expect(await db.select().from(assetObjects)).toHaveLength(1)
		expect(await db.select().from(assets)).toHaveLength(1)
		expect(await db.select().from(versionAssets)).toHaveLength(1)
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(2)
		expect(
			await db.select().from(auditLog).where(eq(auditLog.action, "content.asset.upload"))
		).toHaveLength(1)
		expect(await db.select().from(idempotencyKeys)).toHaveLength(1)
	})

	it("rolls back the complete upload when response persistence fails", async () => {
		const created = await content.create(
			{ requestId: randomUUID(), content: advisory("Response failure"), relatedLinks: [] },
			ACTOR_ID
		)
		await db.execute(
			sql.raw(`
			create function ${RESPONSE_FUNCTION}() returns trigger language plpgsql as $$
			begin
				raise exception 'cm2 task5 response persistence failure';
			end
			$$
		`)
		)
		await db.execute(
			sql.raw(`
			create trigger ${RESPONSE_TRIGGER}
			before insert or update on idempotency_keys
			for each row execute function ${RESPONSE_FUNCTION}()
		`)
		)

		try {
			const key = randomUUID()
			const bytes = prepared("response-failure")
			await expect(
				executeUpload({ key, itemId: created.id, expectedVersionNo: 1, prepared: bytes })
			).rejects.toThrow()

			expect(await db.select().from(assetObjects)).toHaveLength(0)
			expect(await db.select().from(assets)).toHaveLength(0)
			expect(await db.select().from(versionAssets)).toHaveLength(0)
			expect(
				await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
			).toHaveLength(1)
			expect(
				await db.select().from(auditLog).where(eq(auditLog.action, "content.asset.upload"))
			).toHaveLength(0)
			expect(await db.select().from(idempotencyKeys)).toHaveLength(0)
		} finally {
			await removeResponseFailureTrigger()
		}
	})
})
