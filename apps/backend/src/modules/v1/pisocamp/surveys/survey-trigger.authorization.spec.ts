import { Body, Controller, Global, INestApplication, Module, Post } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import type { Server } from "node:http"
import { sql } from "drizzle-orm"
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express"
import { Logger, LoggerModule } from "nestjs-pino"
import request from "supertest"

import { auditLog, surveyTriggerRules } from "@repo/db/schema"

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

import { SurveyTriggerService } from "./survey-trigger.service"
import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"

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
	PERMISSION_NAMES: ["surveys.triggers.configure"],
}))
jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }))

const PERMITTED_ID = "ev3-configurer"
const DENIED_ID = "ev3-denied"

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
	],
}

type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("ev3-triggers")
class Ev3TriggerAuthorizationController {
	constructor(
		private readonly content: ContentService,
		private readonly triggers: SurveyTriggerService,
		private readonly workflow: ContentWorkflowService
	) {}

	/** Publishes a survey a rule can name, using the services a person would. */
	@Post("surveys")
	async publish(@Body() body: { requestId: string }) {
		const created = await this.content.create(
			{ requestId: body.requestId, content: surveyDraft, relatedLinks: [] },
			PERMITTED_ID
		)
		const correlation = (expectedVersionNo: number, comments?: string) =>
			({
				itemId: created.id,
				requestId: crypto.randomUUID(),
				expectedVersionNo,
				...(comments === undefined ? {} : { comments }),
			}) as never
		await this.workflow.transition("submit", correlation(1, "Ready"), PERMITTED_ID)
		await this.workflow.transition("approve", correlation(2, "Checked"), PERMITTED_ID)
		await this.workflow.transition("publish", correlation(3), PERMITTED_ID)
		return { id: created.id }
	}

	@Post("rules")
	@RequirePermissions("surveys.triggers.configure")
	async upsert(@Body() body: { requestId: string; contentItemId: string }) {
		return this.triggers.upsert({
			requestId: body.requestId,
			contentItemId: body.contentItemId,
			triggerType: "topic_completion",
			pageDepth: null,
			frequencyCapDays: 30,
			priority: 10,
			enabled: true,
			actorId: PERMITTED_ID,
		} as never)
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

/**
 * EV-3 AC3. Arranging when a survey appears is its own permission, and both
 * branches are proven on the route that arranges one.
 */
describe("EV-3 survey trigger authorization", () => {
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
			controllers: [Ev3TriggerAuthorizationController],
			providers: [
				ContentService,
				ContentWorkflowService,
				SurveyTriggerService,
				AuditService,
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: RbacGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(app.get(Logger))
		app.use((request_: MiddlewareRequest, _response: ExpressResponse, next: NextFunction) => {
			const id = request_.headers["x-ev3-user"]
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
			truncate table survey_trigger_rule, content_bundle_rebuild_request, version_asset,
				asset, asset_object, survey_question, survey_detail, trivia_question_detail,
				related_link, content_version, content_item, audit_log, idempotency_keys,
				role_permissions, user_roles, permissions, roles, pisocamp_account_state,
				sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-02T00:00:00.000Z")
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${PERMITTED_ID}, 'EV3 Configurer', 'ev3-configurer@example.test', true, ${now}, ${now}),
			       (${DENIED_ID}, 'EV3 Denied', 'ev3-denied@example.test', true, ${now}, ${now})
		`)
		await db.execute(sql`
			with permission as (
				insert into permissions (name, description)
				values ('surveys.triggers.configure', 'Configure survey triggers')
				returning id
			), role as (
				insert into roles (name, description)
				values ('EV3 Configurers', 'EV3 fixture') returning id
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

	async function publishedSurveyId() {
		const created = await agent
			.post("/ev3-triggers/surveys")
			.set("x-ev3-user", PERMITTED_ID)
			.send({ requestId: crypto.randomUUID() })
			.expect(201)
		return (created.body as { id: string }).id
	}

	it("lets a holder of surveys.triggers.configure arrange a trigger", async () => {
		const contentItemId = await publishedSurveyId()

		const response = await agent
			.post("/ev3-triggers/rules")
			.set("x-ev3-user", PERMITTED_ID)
			.send({ requestId: crypto.randomUUID(), contentItemId })
			.expect(201)

		expect((response.body as { triggerType: string }).triggerType).toBe(
			"topic_completion"
		)
		expect(await db.select().from(surveyTriggerRules)).toHaveLength(1)
	})

	it("denies a caller without the permission and audits the denial", async () => {
		const contentItemId = await publishedSurveyId()
		await db.delete(auditLog)

		await agent
			.post("/ev3-triggers/rules")
			.set("x-ev3-user", DENIED_ID)
			.send({ requestId: crypto.randomUUID(), contentItemId })
			.expect(403)

		// No rule was written, and the refusal is on the record.
		expect(await db.select().from(surveyTriggerRules)).toHaveLength(0)
		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			action: "permission_denied",
			outcome: "denied",
			actorId: DENIED_ID,
			targetId: "Ev3TriggerAuthorizationController.upsert",
		})
	})

	it("rejects an unauthenticated request before any permission denial", async () => {
		await agent
			.post("/ev3-triggers/rules")
			.send({
				requestId: crypto.randomUUID(),
				contentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
			})
			.expect(401)

		expect(await db.select().from(auditLog)).toHaveLength(0)
	})
})
