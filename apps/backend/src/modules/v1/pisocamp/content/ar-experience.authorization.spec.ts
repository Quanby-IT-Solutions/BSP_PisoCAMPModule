import { Body, Controller, Global, INestApplication, Module, Post } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import type { Server } from "node:http"
import { sql } from "drizzle-orm"
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express"
import { Logger, LoggerModule } from "nestjs-pino"
import request from "supertest"

import { auditLog, contentItems } from "@repo/db/schema"

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
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
// Type-only at the call sites under test, so a plain stand-in avoids pulling
// the ESM oRPC root into a CommonJS test runtime.
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["content.items.edit"],
}))
jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }))

const PERMITTED_ID = "ar2-author"
const DENIED_ID = "ar2-denied"

const arExperienceDraft = {
	contentType: "ar_experience" as const,
	title: "20-piso coin in augmented reality",
	summary: "Place the NGC 20-piso coin on any surface and turn it.",
	body: "Point the camera at a flat surface, then tap to place the coin.",
	seriesCode: "ngc-coins" as const,
	denominationCode: "php-20",
	deviceRequirement: { minimumAndroidSdk: 26, minimumIosVersion: "13.0" },
	animationDurationMs: 12_000,
		narrationTranscript: "This coin shows the tamaraw of Mindoro.",
}

type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("ar2-experiences")
class Ar2ExperienceAuthorizationController {
	constructor(private readonly content: ContentService) {}

	@Post("experiences")
	@RequirePermissions("content.items.edit")
	create(@Body() body: { requestId: string }) {
		return this.content.create(
			{ requestId: body.requestId, content: arExperienceDraft, relatedLinks: [] },
			PERMITTED_ID
		)
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

/**
 * AR-2 AC4. An AR experience is authored through the same permission as any
 * other content, so both branches are proven on the route that creates one.
 */
describe("AR-2 AR experience authorization", () => {
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
			controllers: [Ar2ExperienceAuthorizationController],
			providers: [
				ContentService,
				AuditService,
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: RbacGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(app.get(Logger))
		app.use((request_: MiddlewareRequest, _response: ExpressResponse, next: NextFunction) => {
			const id = request_.headers["x-ar2-user"]
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
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, version_asset, asset, asset_object,
				survey_question, survey_detail, trivia_question_detail, ar_experience_detail,
				related_link,
				content_version, content_item, audit_log, idempotency_keys, role_permissions,
				user_roles, permissions, roles, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-02T00:00:00.000Z")
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${PERMITTED_ID}, 'AR2 Author', 'ar2-author@example.test', true, ${now}, ${now}),
			       (${DENIED_ID}, 'AR2 Denied', 'ar2-denied@example.test', true, ${now}, ${now})
		`)
		await db.execute(sql`
			with permission as (
				insert into permissions (name, description) values ('content.items.edit', 'Edit content')
				returning id
			), role as (
				insert into roles (name, description) values ('AR2 Authors', 'AR2 fixture') returning id
			), mapping as (
				insert into role_permissions (role_id, permission_id)
				select role.id, permission.id from role, permission returning role_id
			)
			insert into user_roles (user_id, role_id)
			select ${PERMITTED_ID}, role_id from mapping
		`)
	})

	afterAll(async () => {
		if (app) await app.close()
		await db.$client.end()
	})

	it("lets a holder of content.items.edit author an AR experience", async () => {
		const response = await agent
			.post("/ar2-experiences/experiences")
			.set("x-ar2-user", PERMITTED_ID)
			.send({ requestId: crypto.randomUUID() })
			.expect(201)

		expect((response.body as { contentType: string }).contentType).toBe("ar_experience")
		expect(await db.select().from(contentItems)).toHaveLength(1)
	})

	it("denies a caller without the permission and audits the denial", async () => {
		await agent
			.post("/ar2-experiences/experiences")
			.set("x-ar2-user", DENIED_ID)
			.send({ requestId: crypto.randomUUID() })
			.expect(403)

		// Nothing was written, and the refusal is on the record.
		expect(await db.select().from(contentItems)).toHaveLength(0)
		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			action: "permission_denied",
			outcome: "denied",
			actorId: DENIED_ID,
			targetId: "Ar2ExperienceAuthorizationController.create",
		})
	})

	it("rejects an unauthenticated request before any permission denial", async () => {
		await agent
			.post("/ar2-experiences/experiences")
			.send({ requestId: crypto.randomUUID() })
			.expect(401)

		expect(await db.select().from(auditLog)).toHaveLength(0)
	})
})
