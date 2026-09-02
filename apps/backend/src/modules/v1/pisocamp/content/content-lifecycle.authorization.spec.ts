import { Controller, Global, INestApplication, Module, Param, Post, Req } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import type { Server } from "node:http"
import { eq, sql } from "drizzle-orm"
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express"
import { Logger, LoggerModule } from "nestjs-pino"
import request from "supertest"

import { auditLog, contentItems, contentVersions } from "@repo/db/schema"

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

import { ContentWorkflowService } from "./content-workflow.service"

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
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["content.items.publish"],
}))
jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }))

const PERMITTED_ID = "cm6-publisher"
const DENIED_ID = "cm6-denied"
const DEACTIVATED_ID = "cm6-deactivated"
const ITEM_ID = "7d6c0000-0000-4000-8000-000000000011"
const APPROVED_VERSION_ID = "7d6c0000-0000-4000-8000-000000000021"
const PUBLISHED_VERSION_ID = "7d6c0000-0000-4000-8000-000000000022"

type SessionRequest = { session: { user: { id: string } } }
type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("cm6-lifecycle")
class Cm6LifecycleAuthorizationController {
	constructor(private readonly workflow: ContentWorkflowService) {}

	@Post("transition/:action")
	@RequirePermissions("content.items.publish")
	transition(@Req() request_: SessionRequest, @Param("action") action: string) {
		return this.workflow.transition(
			action as "unpublish",
			{ itemId: ITEM_ID, requestId: crypto.randomUUID(), expectedVersionNo: 2 },
			request_.session.user.id
		)
	}

	@Post("schedule")
	@RequirePermissions("content.items.publish")
	schedule(@Req() request_: SessionRequest) {
		return this.workflow.schedulePublication(
			{
				itemId: ITEM_ID,
				requestId: crypto.randomUUID(),
				expectedVersionNo: 2,
				publishAt: new Date(Date.now() + 3_600_000).toISOString(),
			},
			request_.session.user.id
		)
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

describe("CM-6 lifecycle authorization", () => {
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
			controllers: [Cm6LifecycleAuthorizationController],
			providers: [
				ContentWorkflowService,
				AuditService,
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: RbacGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(app.get(Logger))
		app.use((request_: MiddlewareRequest, _response: ExpressResponse, next: NextFunction) => {
			const id = request_.headers["x-cm6-user"]
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
				related_link, content_version, content_item, audit_log, idempotency_keys,
				role_permissions, user_roles, permissions, roles, pisocamp_account_state,
				sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-02T00:00:00.000Z")
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${PERMITTED_ID}, 'CM6 Publisher', 'cm6-publisher@example.test', true, ${now}, ${now}),
			       (${DENIED_ID}, 'CM6 Denied', 'cm6-denied@example.test', true, ${now}, ${now}),
			       (${DEACTIVATED_ID}, 'CM6 Deactivated', 'cm6-deact@example.test', true, ${now}, ${now})
		`)
		await db.execute(sql`
			with permission as (
				insert into permissions (name, description) values ('content.items.publish', 'Publish content')
				returning id
			), role as (
				insert into roles (name, description) values ('CM6 Publishers', 'CM6 fixture') returning id
			), mapping as (
				insert into role_permissions (role_id, permission_id)
				select role.id, permission.id from role, permission returning role_id
			)
			insert into user_roles (user_id, role_id)
			select unnest(array[${PERMITTED_ID}, ${DEACTIVATED_ID}]), role_id from mapping
		`)
		await db.execute(sql`
			insert into pisocamp_account_state (account_id, status, reason)
			values (${DEACTIVATED_ID}, 'deactivated', 'CM6 ordering fixture')
		`)
		await db.execute(sql`
			insert into content_item (id, content_type, status, created_by, last_edited_by, created_at, updated_at)
			values (${ITEM_ID}, 'advisory', 'published', ${PERMITTED_ID}, ${PERMITTED_ID}, ${now}, ${now})
		`)
		await db.execute(sql`
			insert into content_version (id, item_id, version_no, status, content_type, title, summary,
				body, created_by, created_at, approved_by, approved_at, transition_action, transition_comments)
			values (${APPROVED_VERSION_ID}, ${ITEM_ID}, 1, 'approved', 'advisory',
				'Handle banknotes with care', 'Approved advisory copy.', 'Approved body copy.',
				${PERMITTED_ID}, ${now}, ${PERMITTED_ID}, ${now}, 'approve', 'Checked')
		`)
		await db.execute(sql`
			insert into content_version (id, item_id, version_no, parent_version_id, status, content_type,
				title, summary, body, created_by, created_at, approved_by, approved_at,
				published_by, published_at, transition_action)
			values (${PUBLISHED_VERSION_ID}, ${ITEM_ID}, 2, ${APPROVED_VERSION_ID}, 'published', 'advisory',
				'Handle banknotes with care', 'Approved advisory copy.', 'Approved body copy.',
				${PERMITTED_ID}, ${now}, ${PERMITTED_ID}, ${now}, ${PERMITTED_ID}, ${now}, 'publish')
		`)
		await db
			.update(contentItems)
			.set({
				currentWorkingVersionId: PUBLISHED_VERSION_ID,
				currentPublishedVersionId: PUBLISHED_VERSION_ID,
			})
			.where(eq(contentItems.id, ITEM_ID))
	})

	afterAll(async () => {
		if (app) await app.close()
		await db.$client.end()
	})

	it("lets a holder of content.items.publish withdraw published content", async () => {
		const response = await agent
			.post("/cm6-lifecycle/transition/unpublish")
			.set("x-cm6-user", PERMITTED_ID)
			.expect(201)

		expect((response.body as { status: string }).status).toBe("unpublished")
		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "content",
			action: "content.unpublish",
			outcome: "success",
			actorId: PERMITTED_ID,
		})
	})

	it.each([
		["unpublish", "transition/unpublish"],
		["deactivate", "transition/deactivate"],
		["archive", "transition/archive"],
		["schedule", "schedule"],
	])("denies %s without content.items.publish and writes no version", async (_label, route) => {
		await agent.post(`/cm6-lifecycle/${route}`).set("x-cm6-user", DENIED_ID).expect(403)

		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			action: "permission_denied",
			outcome: "denied",
			actorId: DENIED_ID,
		})
		expect(await db.select().from(contentVersions)).toHaveLength(2)
	})

	it("rejects a deactivated holder before permission resolution", async () => {
		await agent
			.post("/cm6-lifecycle/transition/unpublish")
			.set("x-cm6-user", DEACTIVATED_ID)
			.expect(401)

		expect(await db.select().from(auditLog)).toHaveLength(0)
		expect(await db.select().from(contentVersions)).toHaveLength(2)
	})
})
