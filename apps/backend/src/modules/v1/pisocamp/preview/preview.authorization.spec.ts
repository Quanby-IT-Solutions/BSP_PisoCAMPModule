import {
	Controller,
	Get,
	Global,
	INestApplication,
	Module,
	Query,
	Req,
	VersioningType,
} from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { createHash } from "node:crypto"
import type { Server } from "node:http"
import { deflateSync } from "node:zlib"
import { eq } from "drizzle-orm"
import type {
	Application,
	Request as ExpressRequest,
	Response as ExpressResponse,
	NextFunction,
} from "express"
import { Logger, LoggerModule } from "nestjs-pino"
import pinoHttp from "pino-http"
import request from "supertest"

import {
	assetObjects,
	assets,
	auditLog,
	contentBundleManifestEntries,
	contentBundleRebuildRequests,
	contentBundles,
	contentItems,
	contentVersions,
	permissions,
	pisoCampAccountState,
	relatedLinks,
	rolePermissions,
	roles,
	userRoles,
	users,
	versionAssets,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { HttpExceptionFilter } from "@/common/filters/http-exception.filter"
import { SentryExceptionFilter } from "@/common/filters/sentry-exception.filter"
import { RbacModule } from "@/common/rbac/rbac.module"
import { REDIS_CLIENT } from "@/common/redis/redis.provider"
import { buildPinoHttpOptions } from "@/config/pino-logger.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { RbacGuard } from "@/shared/guards/rbac.guard"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PostgresAssetObjectStore } from "../assets/asset-object-store"
import { PreviewResourceController } from "./preview-resource.controller"
import { derivePreviewTokenKey, signPreviewToken } from "./preview-token"
import { PREVIEW_TOKEN_CONFIG, PreviewService } from "./preview.service"

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
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
// Decorator-only dependency of the resource controller; the ESM build cannot
// load under ts-jest and the guard under test reads its own metadata key.
jest.mock("@thallesp/nestjs-better-auth", () => ({ AllowAnonymous: () => () => undefined }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["content.items.preview"],
}))
jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }))

const PERMITTED_ID = "cm5-previewer"
const DENIED_ID = "cm5-denied"
const DEACTIVATED_ID = "cm5-deactivated"
const ITEM_ID = "0a1e4d1b-6a44-4d8f-8a5c-3f47c0a4a201"
const DRAFT_VERSION_ID = "1b2e4d1b-6a44-4d8f-8a5c-3f47c0a4a202"
const PUBLISHED_VERSION_ID = "2c3e4d1b-6a44-4d8f-8a5c-3f47c0a4a203"
const ASSET_ID = "3d4e4d1b-6a44-4d8f-8a5c-3f47c0a4a204"
const UNATTACHED_ASSET_ID = "4e5e4d1b-6a44-4d8f-8a5c-3f47c0a4a205"
const TTL_SECONDS = 300

const crc32 = (bytes: Buffer) => {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
	}
	return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data = Buffer.alloc(0)) => {
	const name = Buffer.from(type, "ascii")
	const chunk = Buffer.alloc(12 + data.length)
	chunk.writeUInt32BE(data.length, 0)
	name.copy(chunk, 4)
	data.copy(chunk, 8)
	chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
	return chunk
}

const png = () => {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(1, 0)
	ihdr.writeUInt32BE(1, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(Buffer.alloc(5))),
		pngChunk("IEND"),
	])
}

const PNG_BYTES = png()
const PNG_SHA256 = createHash("sha256").update(PNG_BYTES).digest("hex")

const previewKey = derivePreviewTokenKey({ authSecret: "cm5-preview-authorization-secret-value" })

type SessionRequest = { session: { user: { id: string } } }
type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("cm5-preview")
class Cm5PreviewAuthorizationController {
	constructor(private readonly previewService: PreviewService) {}

	@Get("grant")
	@RequirePermissions("content.items.preview")
	grant(@Req() request_: SessionRequest, @Query("versionNo") versionNo: string) {
		return this.previewService.createGrant(
			{ itemId: ITEM_ID, versionNo: Number(versionNo) },
			request_.session.user.id
		)
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

async function contentSnapshot() {
	const [items, versions, attachments, bundles, manifestEntries, rebuilds] = await Promise.all([
		db.select().from(contentItems),
		db.select().from(contentVersions),
		db.select().from(versionAssets),
		db.select().from(contentBundles),
		db.select().from(contentBundleManifestEntries),
		db.select().from(contentBundleRebuildRequests),
	])
	return { items, versions, attachments, bundles, manifestEntries, rebuilds }
}

describe("CM-5 preview authorization and read-only guarantees", () => {
	let app: INestApplication
	let agent: ReturnType<typeof request>

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		const moduleRef = await Test.createTestingModule({
			imports: [
				TestRedisModule,
				RbacModule,
				LoggerModule.forRoot({
					pinoHttp: [
						{ ...buildPinoHttpOptions({ autoLogging: false }), transport: undefined },
						{ write: () => {} },
					],
				}),
			],
			controllers: [Cm5PreviewAuthorizationController, PreviewResourceController],
			providers: [
				PreviewService,
				PostgresAssetObjectStore,
				{
					provide: PREVIEW_TOKEN_CONFIG,
					useValue: { key: previewKey, ttlSeconds: TTL_SECONDS },
				},
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: RbacGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		// Same URI versioning bootstrap.ts installs, so the resource route is
		// exercised at the exact public path clients use.
		app.enableVersioning({ type: VersioningType.URI })
		app.useLogger(app.get(Logger))
		const expressApp = app.getHttpAdapter().getInstance() as Application
		expressApp.use(
			pinoHttp({ ...buildPinoHttpOptions(), transport: undefined }, { write: () => {} })
		)
		app.use((request_: MiddlewareRequest, _response: ExpressResponse, next: NextFunction) => {
			const id = request_.headers["x-cm5-user"]
			if (typeof id === "string") {
				request_.session = { user: { id } }
				request_.user = request_.session.user
			}
			next()
		})
		await app.init()
		agent = request(app.getHttpServer() as Server)
	})

	beforeEach(async () => {
		await db.execute(`
			truncate table content_bundle_manifest_entry, content_bundle_blob, content_bundle_channel,
				content_bundle_rebuild_request, content_bundle, version_asset, asset, asset_object,
				related_link, content_version, content_item, audit_log, role_permissions, user_roles,
				permissions, roles, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-02T00:00:00.000Z")
		await db.insert(users).values(
			[PERMITTED_ID, DENIED_ID, DEACTIVATED_ID].map(id => ({
				id,
				name: "CM-5 fixture",
				email: `${id}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const [permission] = await db
			.insert(permissions)
			.values({ name: "content.items.preview", description: "Preview content" })
			.returning()
		const [role] = await db
			.insert(roles)
			.values({ name: "CM-5 Previewers", description: "CM-5 fixture" })
			.returning()
		await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id })
		await db.insert(userRoles).values([
			{ userId: PERMITTED_ID, roleId: role!.id },
			{ userId: DEACTIVATED_ID, roleId: role!.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: DEACTIVATED_ID,
			status: "deactivated",
			reason: "CM-5 ordering fixture",
		})

		await db.insert(contentItems).values({
			id: ITEM_ID,
			contentType: "advisory",
			status: "draft",
			createdBy: PERMITTED_ID,
			lastEditedBy: PERMITTED_ID,
		})
		await db.insert(contentVersions).values([
			{
				id: DRAFT_VERSION_ID,
				itemId: ITEM_ID,
				versionNo: 1,
				status: "draft",
				contentType: "advisory",
				title: "Handle banknotes with care",
				summary: "Approved advisory copy under review.",
				body: "Do not fold, staple or write on Philippine banknotes.",
				createdBy: PERMITTED_ID,
			},
			{
				id: PUBLISHED_VERSION_ID,
				itemId: ITEM_ID,
				versionNo: 2,
				status: "published",
				contentType: "advisory",
				title: "Handle banknotes with care",
				summary: "Approved advisory copy already live.",
				body: "Published advisory copy.",
				createdBy: PERMITTED_ID,
				approvedBy: PERMITTED_ID,
				approvedAt: now,
				publishedBy: PERMITTED_ID,
				publishedAt: now,
				transitionAction: "publish" as const,
			},
		])
		await db
			.update(contentItems)
			.set({ currentWorkingVersionId: DRAFT_VERSION_ID })
			.where(eq(contentItems.id, ITEM_ID))
		await db.insert(relatedLinks).values({
			contentVersionId: DRAFT_VERSION_ID,
			position: 0,
			kind: "external",
			label: "BSP currency page",
			externalUrl: "https://www.bsp.gov.ph/currency",
		})
		await db.insert(assetObjects).values({
			sha256: PNG_SHA256,
			byteLength: PNG_BYTES.length,
			mediaType: "image/png",
			body: PNG_BYTES,
		})
		await db.insert(assets).values([
			{
				id: ASSET_ID,
				contentItemId: ITEM_ID,
				sha256: PNG_SHA256,
				byteLength: PNG_BYTES.length,
				mediaType: "image/png",
				uploadedBy: PERMITTED_ID,
			},
			{
				id: UNATTACHED_ASSET_ID,
				contentItemId: ITEM_ID,
				sha256: PNG_SHA256,
				byteLength: PNG_BYTES.length,
				mediaType: "image/png",
				uploadedBy: PERMITTED_ID,
			},
		])
		await db.insert(versionAssets).values({
			contentItemId: ITEM_ID,
			contentVersionId: DRAFT_VERSION_ID,
			assetId: ASSET_ID,
			role: "obverse",
		})
	})

	afterAll(async () => {
		if (app) await app.close()
		await db.$client.end()
	})

	const grant = (actorId: string, versionNo = 1) =>
		agent.get(`/cm5-preview/grant?versionNo=${versionNo}`).set("x-cm5-user", actorId)

	it("renders the requested draft with its links and attachments for a permission holder", async () => {
		const before = await contentSnapshot()
		const response = await grant(PERMITTED_ID).expect(200)
		const body = response.body as {
			token: string
			expiresAt: string
			preview: Record<string, unknown>
		}

		expect(body.preview).toMatchObject({
			itemId: ITEM_ID,
			versionId: DRAFT_VERSION_ID,
			versionNo: 1,
			status: "draft",
			contentType: "advisory",
			content: expect.objectContaining({
				contentType: "advisory",
				title: "Handle banknotes with care",
				body: "Do not fold, staple or write on Philippine banknotes.",
			}),
			relatedLinks: [expect.objectContaining({ kind: "external", label: "BSP currency page" })],
			assets: [
				{
					role: "obverse",
					assetId: ASSET_ID,
					mediaType: "image/png",
					byteLength: PNG_BYTES.length,
					sha256: PNG_SHA256,
				},
			],
		})
		expect(body.token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
		expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(TTL_SECONDS * 1_000)
		expect(await contentSnapshot()).toEqual(before)
	})

	it("records exactly one metadata-only preview audit and no publication side effect", async () => {
		await grant(PERMITTED_ID).expect(200)
		const rows = await db.select().from(auditLog)

		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "content",
			action: "content.preview",
			outcome: "success",
			actorId: PERMITTED_ID,
			targetType: "content_version",
			targetId: DRAFT_VERSION_ID,
		})
		expect(rows[0]?.newValue).toMatchObject({ itemId: ITEM_ID, versionNo: 1, status: "draft" })
		expect(JSON.stringify(rows[0])).not.toMatch(/v1\.[A-Za-z0-9_-]{20}/)

		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, ITEM_ID))
		expect(item).toMatchObject({
			status: "draft",
			currentPublishedVersionId: null,
			bundlePending: false,
		})
		expect(await db.select().from(contentBundleRebuildRequests)).toHaveLength(0)
	})

	it("denies a caller without content.items.preview and audits the denial", async () => {
		await grant(DENIED_ID).expect(403)

		const rows = await db.select().from(auditLog)
		expect(rows).toEqual([
			expect.objectContaining({
				domain: "rbac",
				action: "permission_denied",
				outcome: "denied",
				actorId: DENIED_ID,
				targetId: "Cm5PreviewAuthorizationController.grant",
			}),
		])
		expect(rows.some(row => row.action === "content.preview")).toBe(false)
	})

	it("rejects a deactivated permission holder before permission resolution", async () => {
		await grant(DEACTIVATED_ID).expect(401)

		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("refuses to preview a published version and leaves no audit trail behind", async () => {
		await expect(
			app.get(PreviewService).createGrant({ itemId: ITEM_ID, versionNo: 2 }, PERMITTED_ID)
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Only draft, submitted or approved versions can be previewed",
		})

		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("refuses to preview a version number the item does not have", async () => {
		await expect(
			app.get(PreviewService).createGrant({ itemId: ITEM_ID, versionNo: 99 }, PERMITTED_ID)
		).rejects.toMatchObject({ code: "NOT_FOUND" })

		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("redeems a grant for the exact version it names", async () => {
		const response = await grant(PERMITTED_ID).expect(200)
		const token = (response.body as { token: string }).token
		const service = app.get(PreviewService)

		await expect(service.redeem(token)).resolves.toMatchObject({
			versionId: DRAFT_VERSION_ID,
			versionNo: 1,
			status: "draft",
		})
	})

	it("serves attached preview bytes as uncacheable and refuses everything else", async () => {
		const token = (await grant(PERMITTED_ID).expect(200)).body.token as string

		const ok = await agent
			.get(`/v1/pisocamp/preview/resources/${ASSET_ID}?token=${encodeURIComponent(token)}`)
			.expect(200)
		expect(ok.headers["cache-control"]).toBe("no-store")
		expect(ok.headers["content-type"]).toBe("image/png")
		expect(ok.headers["x-content-type-options"]).toBe("nosniff")
		expect(ok.headers.etag).toBe(`"${PNG_SHA256}"`)
		expect(Buffer.from(ok.body as Buffer).equals(PNG_BYTES)).toBe(true)

		await agent
			.get(
				`/v1/pisocamp/preview/resources/${UNATTACHED_ASSET_ID}?token=${encodeURIComponent(token)}`
			)
			.expect(404)
		await agent.get(`/v1/pisocamp/preview/resources/${ASSET_ID}`).expect(404)
		await agent.get(`/v1/pisocamp/preview/resources/${ASSET_ID}?token=v1.aaaa.bbbb`).expect(401)
	})

	it("fails a signed grant closed when the live version is no longer previewable", async () => {
		const forged = signPreviewToken(previewKey, {
			itemId: ITEM_ID,
			versionId: PUBLISHED_VERSION_ID,
			versionNo: 2,
			status: "approved",
			actorId: PERMITTED_ID,
			expiresAt: Date.now() + TTL_SECONDS * 1_000,
		})

		await expect(app.get(PreviewService).redeem(forged)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
	})

	it("never lets a preview reach the published bundle candidate set", async () => {
		await grant(PERMITTED_ID).expect(200)
		const audit = app.get(AuditService)

		expect(audit).toBeDefined()
		expect(await db.select().from(contentBundles)).toHaveLength(0)
		expect(await db.select().from(contentBundleManifestEntries)).toHaveLength(0)
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, ITEM_ID))
		expect(item?.currentPublishedVersionId).toBeNull()
	})
})
