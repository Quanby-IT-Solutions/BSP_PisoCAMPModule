import {
	Controller,
	Global,
	INestApplication,
	Module,
	Post,
	Req,
	UseInterceptors,
} from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { randomUUID } from "node:crypto"
import { readdir } from "node:fs/promises"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
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
	contentItems,
	contentVersions,
	permissions,
	pisoCampAccountState,
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

import * as filePolicy from "./asset-file-policy"
import { PostgresAssetObjectStore } from "./asset-object-store"
import { AssetUploadInterceptor, getPreparedAssetUpload } from "./asset-upload.interceptor"
import { AssetsService } from "./assets.service"

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
jest.mock("@repo/auth", () => ({
	getAuth: () => ({ api: { getSession: async () => null } }),
}))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["content.assets.upload"],
}))

const mockCaptureException = jest.fn()

jest.mock("@sentry/nestjs", () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

const PERMITTED_ID = "cm2-task5-authorized"
const DENIED_ID = "cm2-task5-denied"
const DEACTIVATED_ID = "cm2-task5-deactivated"
const ITEM_ID = "4da061c8-42e9-486c-9a7b-514849653d50"
const VERSION_ID = "369196f8-b4b4-4fa7-96c8-0711950a6d8d"
const BYTE_SENTINEL = "private-task7-file-byte-sentinel"
const COOKIE_SENTINEL = "private-task7-session-cookie"
const PASSWORD_SENTINEL = "private-task7-password"
const TOKEN_SENTINEL = "private-task7-bearer-token"

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

type AuthorizationRequest = {
	body: Record<string, string | File>
	session: { user: { id: string } }
}

type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("task5-assets")
class Task5AssetsAuthorizationController {
	constructor(private readonly assetsService: AssetsService) {}

	@Post("upload")
	@RequirePermissions("content.assets.upload")
	@UseInterceptors(AssetUploadInterceptor)
	upload(@Req() request: AuthorizationRequest) {
		const prepared = getPreparedAssetUpload(request)
		return this.assetsService.upload(
			prepared,
			{
				file: request.body.file as File,
				itemId: request.body.itemId as string,
				expectedVersionNo: Number(request.body.expectedVersionNo),
				role: request.body.role as "obverse",
				requestId: request.body.requestId as string,
			},
			request.session.user.id
		)
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

const upload = (agent: ReturnType<typeof request>, actorId: string) =>
	agent
		.post("/task5-assets/upload")
		.set("x-task5-user", actorId)
		.set("cookie", `better-auth.session_token=${COOKIE_SENTINEL}`)
		.set("authorization", `Bearer ${TOKEN_SENTINEL}`)
		.field("itemId", ITEM_ID)
		.field("expectedVersionNo", "1")
		.field("role", "obverse")
		.field("requestId", randomUUID())
		.attach("file", png(), { filename: "private-task5-name.png", contentType: "text/plain" })

const permittedUpload = (agent: ReturnType<typeof request>) =>
	agent
		.post("/task5-assets/upload")
		.set("x-task5-user", PERMITTED_ID)
		.field("itemId", ITEM_ID)
		.field("expectedVersionNo", "1")
		.field("role", "obverse")
		.field("requestId", randomUUID())

const uploadDirectories = async () =>
	(await readdir(tmpdir())).filter(name => name.startsWith("pisocamp-asset-upload-")).sort()

function expectSafeOutput(responseText: string, logs: string) {
	const output = `${responseText}\n${logs}`
	expect(output).not.toMatch(
		/private-task5-name|private-task7|pisocamp-asset-upload|better-auth\.session_token|"stack"|\n\s+at /i
	)
}

describe("asset authorization and parser ordering", () => {
	let app: INestApplication
	let agent: ReturnType<typeof request>
	let prepareSpy: jest.SpyInstance
	let logChunks: string[]

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		prepareSpy = jest.spyOn(filePolicy, "prepareAssetUpload")
		logChunks = []
		const logStream = { write: (chunk: string) => logChunks.push(chunk) }
		const moduleRef = await Test.createTestingModule({
			imports: [
				TestRedisModule,
				RbacModule,
				LoggerModule.forRoot({
					pinoHttp: [
						{ ...buildPinoHttpOptions({ autoLogging: false }), transport: undefined },
						logStream,
					],
				}),
			],
			controllers: [Task5AssetsAuthorizationController],
			providers: [
				AssetsService,
				PostgresAssetObjectStore,
				AssetUploadInterceptor,
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: RbacGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(app.get(Logger))
		const expressApp = app.getHttpAdapter().getInstance() as Application
		expressApp.use(pinoHttp({ ...buildPinoHttpOptions(), transport: undefined }, logStream))
		app.use((request_: MiddlewareRequest, _response: ExpressResponse, next: NextFunction) => {
			const id = request_.headers["x-task5-user"]
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
		prepareSpy.mockClear()
		mockCaptureException.mockClear()
		logChunks = []
		await db.execute(`
			truncate table version_asset, asset, asset_object, related_link, content_version,
				content_item, audit_log, idempotency_keys, role_permissions, user_roles,
				permissions, roles, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[PERMITTED_ID, DENIED_ID, DEACTIVATED_ID].map(id => ({
				id,
				name: "Task 5 fixture",
				email: `${id}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const [permission] = await db
			.insert(permissions)
			.values({ name: "content.assets.upload", description: "Manage content assets" })
			.returning()
		const [role] = await db
			.insert(roles)
			.values({ name: "Task 5 Asset Editors", description: "Task 5 fixture" })
			.returning()
		await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id })
		await db.insert(userRoles).values([
			{ userId: PERMITTED_ID, roleId: role!.id },
			{ userId: DEACTIVATED_ID, roleId: role!.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: DEACTIVATED_ID,
			status: "deactivated",
			reason: "Task 5 ordering fixture",
		})
		await db.insert(contentItems).values({
			id: ITEM_ID,
			contentType: "advisory",
			status: "draft",
			createdBy: PERMITTED_ID,
			lastEditedBy: PERMITTED_ID,
		})
		await db.insert(contentVersions).values({
			id: VERSION_ID,
			itemId: ITEM_ID,
			versionNo: 1,
			status: "draft",
			contentType: "advisory",
			title: "Task 5 authorization",
			summary: "Guard ordering fixture",
			body: "Asset bytes must never be parsed before authorization.",
			createdBy: PERMITTED_ID,
		})
		await db
			.update(contentItems)
			.set({ currentWorkingVersionId: VERSION_ID })
			.where(eq(contentItems.id, ITEM_ID))
	})

	afterAll(async () => {
		prepareSpy.mockRestore()
		if (app) await app.close()
		await db.$client.end()
	})

	it("denies missing permission before multipart parsing and records one denial audit", async () => {
		const beforeDirectories = await uploadDirectories()
		const response = await upload(agent, DENIED_ID).expect(403)

		expect(prepareSpy).not.toHaveBeenCalled()
		expect(await uploadDirectories()).toEqual(beforeDirectories)
		expect(await db.select().from(assetObjects)).toHaveLength(0)
		expect(await db.select().from(assets)).toHaveLength(0)
		expect(await db.select().from(versionAssets)).toHaveLength(0)
		expect(await db.select().from(contentVersions)).toHaveLength(1)
		expect(await db.select().from(auditLog)).toEqual([
			expect.objectContaining({
				domain: "rbac",
				action: "permission_denied",
				outcome: "denied",
				actorId: DENIED_ID,
				targetId: "Task5AssetsAuthorizationController.upload",
			}),
		])
		expectSafeOutput(response.text, logChunks.join(""))
	})

	it("rejects a deactivated permission holder before permission resolution or parsing", async () => {
		const beforeDirectories = await uploadDirectories()
		await upload(agent, DEACTIVATED_ID).expect(401)

		expect(prepareSpy).not.toHaveBeenCalled()
		expect(await uploadDirectories()).toEqual(beforeDirectories)
		expect(await db.select().from(assetObjects)).toHaveLength(0)
		expect(await db.select().from(assets)).toHaveLength(0)
		expect(await db.select().from(versionAssets)).toHaveLength(0)
		expect(await db.select().from(contentVersions)).toHaveLength(1)
		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("allows the exact permission and records one metadata-only success audit", async () => {
		const response = await upload(agent, PERMITTED_ID).expect(201)

		expect(prepareSpy).toHaveBeenCalledTimes(1)
		expect(await db.select().from(assetObjects)).toHaveLength(1)
		expect(await db.select().from(assets)).toHaveLength(1)
		expect(await db.select().from(versionAssets)).toHaveLength(1)
		expect(await db.select().from(contentVersions)).toHaveLength(2)
		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "content",
			action: "content.asset.upload",
			outcome: "success",
			actorId: PERMITTED_ID,
		})
		expect(JSON.stringify(rows[0])).not.toMatch(
			/private-task5-name|pisocamp-asset-upload|body|bytes/i
		)
		expectSafeOutput(response.text, logChunks.join(""))
	})

	it("rejects byte/MIME spoofing without reflecting or logging upload data", async () => {
		const filename = "private-task7-spoof-name.png"
		const response = await permittedUpload(agent)
			.set("cookie", `better-auth.session_token=${COOKIE_SENTINEL}`)
			.set("authorization", `Bearer ${TOKEN_SENTINEL}`)
			.field("password", PASSWORD_SENTINEL)
			.attach("file", Buffer.from(BYTE_SENTINEL), {
				filename,
				contentType: "image/png",
			})
			.expect(400)

		expect(response.text).toContain("Invalid asset upload")
		expectSafeOutput(response.text, logChunks.join(""))
		expect(await db.select().from(assetObjects)).toHaveLength(0)
	})

	it("returns a safe 413 for 50 MiB plus one without relying on Nginx", async () => {
		const filename = "private-task7-oversize-name.png"
		const response = await permittedUpload(agent)
			.attach("file", Buffer.alloc(52_428_801, 0x61), {
				filename,
				contentType: "application/octet-stream",
			})
			.expect(413)

		expect(response.text).toContain("Asset upload exceeds the allowed size")
		expect(response.text).not.toContain(filename)
		expectSafeOutput(response.text, logChunks.join(""))
		expect(prepareSpy).not.toHaveBeenCalled()
		expect(await db.select().from(assetObjects)).toHaveLength(0)
	})

	it.each([
		["an absent inbound request id", undefined],
		["a malicious inbound request id", "private-task7-malicious/id"],
	] as const)(
		"rolls back a failed success audit with %s and one canonical safe correlation id",
		async (_case, inboundRequestId) => {
			const audit = app.get(AuditService)
			const rollbackError = new Error(
				"private-task7-internal-rollback-sentinel C:\\private\\task7\\rollback.ts"
			)
			const auditSpy = jest.spyOn(audit, "record").mockRejectedValueOnce(rollbackError)

			try {
				const pending = upload(agent, PERMITTED_ID)
				if (inboundRequestId) pending.set("x-request-id", inboundRequestId)
				const response = await pending.expect(500)
				const canonicalRequestId = response.headers["x-request-id"] as string
				const records = logChunks.map(line => JSON.parse(line) as Record<string, unknown>)
				const filterRecord = records.find(record => record.context === "Unhandled exception")

				expect(canonicalRequestId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
				)
				expect(filterRecord).toMatchObject({
					requestId: canonicalRequestId,
					errorName: "Error",
				})
				if (inboundRequestId) expect(logChunks.join("")).not.toContain(inboundRequestId)
				expect(response.text).toContain("Internal server error")
				expectSafeOutput(response.text, logChunks.join(""))
				expect(await db.select().from(assetObjects)).toHaveLength(0)
				expect(await db.select().from(assets)).toHaveLength(0)
				expect(await db.select().from(versionAssets)).toHaveLength(0)
				expect(await db.select().from(contentVersions)).toHaveLength(1)
				expect(await db.select().from(auditLog)).toHaveLength(0)
				expect(mockCaptureException).toHaveBeenCalledWith(rollbackError)
			} finally {
				auditSpy.mockRestore()
			}
		}
	)

	it.each([
		[
			"more than one file",
			(test: ReturnType<typeof permittedUpload>) =>
				test
					.attach("file", png(), "private-task7-first.png")
					.attach("file", png(), "private-task7-second.png"),
		],
		[
			"more than six scalar fields",
			(test: ReturnType<typeof permittedUpload>) =>
				test.field("one", "1").field("two", "2").field("three", "3"),
		],
		[
			"a scalar field name longer than 100 bytes",
			(test: ReturnType<typeof permittedUpload>) =>
				test.field(`private-${"n".repeat(101)}`, "value"),
		],
		[
			"a scalar field value longer than 1 KiB",
			(test: ReturnType<typeof permittedUpload>) => test.field("privateValue", "v".repeat(1025)),
		],
	] as const)("returns a safe 400 for %s", async (_case, mutate) => {
		const filename = "private-task7-invalid-shape.png"
		const pending = mutate(permittedUpload(agent))
		const response = await (pending as ReturnType<typeof permittedUpload>)
			.attach("file", png(), filename)
			.expect(400)

		expect(response.text).toContain("Invalid asset upload")
		expect(response.text).not.toMatch(/private-task7|pisocamp-asset-upload|stack/i)
		expect(prepareSpy).not.toHaveBeenCalled()
		expect(await db.select().from(assetObjects)).toHaveLength(0)
	})
})
