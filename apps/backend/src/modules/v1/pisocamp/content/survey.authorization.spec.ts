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

const PERMITTED_ID = "ev1-author"
const DENIED_ID = "ev1-denied"

const surveyDraft = {
	contentType: "survey" as const,
	title: "How did we do?",
	summary: "A short evaluation shown after a topic.",
	body: "Answering is optional and takes less than a minute.",
	purpose: "satisfaction" as const,
	subjectContentItemId: null,
	questions: [
		{
			kind: "rating" as const,
			prompt: "How clear was this topic?",
			required: true,
			lowLabel: "Not clear at all",
			highLabel: "Very clear",
		},
		{ kind: "text" as const, prompt: "What would you change?", required: false },
	],
}

type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("ev1-surveys")
class Ev1SurveyAuthorizationController {
	constructor(private readonly content: ContentService) {}

	@Post("surveys")
	@RequirePermissions("content.items.edit")
	create(@Body() body: { requestId: string }) {
		return this.content.create(
			{ requestId: body.requestId, content: surveyDraft, relatedLinks: [] },
			PERMITTED_ID
		)
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

/**
 * EV-1 AC4. A survey is authored through the same permission as any other
 * content, so both branches are proven on the route that creates one.
 */
describe("EV-1 survey authorization", () => {
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
			controllers: [Ev1SurveyAuthorizationController],
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
			const id = request_.headers["x-ev1-user"]
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
				survey_question, survey_detail, trivia_question_detail, related_link,
				content_version, content_item, audit_log, idempotency_keys, role_permissions,
				user_roles, permissions, roles, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-02T00:00:00.000Z")
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${PERMITTED_ID}, 'EV1 Author', 'ev1-author@example.test', true, ${now}, ${now}),
			       (${DENIED_ID}, 'EV1 Denied', 'ev1-denied@example.test', true, ${now}, ${now})
		`)
		await db.execute(sql`
			with permission as (
				insert into permissions (name, description) values ('content.items.edit', 'Edit content')
				returning id
			), role as (
				insert into roles (name, description) values ('EV1 Authors', 'EV1 fixture') returning id
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

	it("lets a holder of content.items.edit author a survey", async () => {
		const response = await agent
			.post("/ev1-surveys/surveys")
			.set("x-ev1-user", PERMITTED_ID)
			.send({ requestId: crypto.randomUUID() })
			.expect(201)

		expect((response.body as { contentType: string }).contentType).toBe("survey")
		expect(await db.select().from(contentItems)).toHaveLength(1)
	})

	it("denies a caller without the permission and audits the denial", async () => {
		await agent
			.post("/ev1-surveys/surveys")
			.set("x-ev1-user", DENIED_ID)
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
			targetId: "Ev1SurveyAuthorizationController.create",
		})
	})

	it("rejects an unauthenticated request before any permission denial", async () => {
		await agent
			.post("/ev1-surveys/surveys")
			.send({ requestId: crypto.randomUUID() })
			.expect(401)

		expect(await db.select().from(auditLog)).toHaveLength(0)
	})
})
