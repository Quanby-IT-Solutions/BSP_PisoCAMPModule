import { Controller, Get, Global, INestApplication, Module } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import type { Server } from "node:http"
import { sql } from "drizzle-orm"
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express"
import { Logger, LoggerModule } from "nestjs-pino"
import request from "supertest"

import { auditLog } from "@repo/db/schema"

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

import { ContentAuditService } from "./content-audit.service"

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
	PERMISSION_NAMES: ["content.audit.view"],
}))
jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }))

const PERMITTED_ID = "cm7-auditor"
const DENIED_ID = "cm7-denied"
const DEACTIVATED_ID = "cm7-deactivated"
const ITEM_ID = "3f7c0000-0000-4000-8000-000000000011"
const VERSION_ID = "3f7c0000-0000-4000-8000-000000000021"

type MiddlewareRequest = ExpressRequest & {
	session?: { user: { id: string } }
	user?: { id: string }
}

@Controller("cm7-audit")
class Cm7AuditAuthorizationController {
	constructor(private readonly audit: ContentAuditService) {}

	@Get("history")
	@RequirePermissions("content.audit.view")
	history() {
		return this.audit.list({ itemId: ITEM_ID, page: 1, limit: 25 })
	}
}

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

describe("CM-7 content audit authorization", () => {
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
			controllers: [Cm7AuditAuthorizationController],
			providers: [
				ContentAuditService,
				AuditService,
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: RbacGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(app.get(Logger))
		app.use((request_: MiddlewareRequest, _response: ExpressResponse, next: NextFunction) => {
			const id = request_.headers["x-cm7-user"]
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
			values (${PERMITTED_ID}, 'CM7 Auditor', 'cm7-auditor@example.test', true, ${now}, ${now}),
			       (${DENIED_ID}, 'CM7 Denied', 'cm7-denied@example.test', true, ${now}, ${now}),
			       (${DEACTIVATED_ID}, 'CM7 Deactivated', 'cm7-deact@example.test', true, ${now}, ${now})
		`)
		await db.execute(sql`
			with permission as (
				insert into permissions (name, description) values ('content.audit.view', 'View content audit')
				returning id
			), role as (
				insert into roles (name, description) values ('CM7 Auditors', 'CM7 fixture') returning id
			), mapping as (
				insert into role_permissions (role_id, permission_id)
				select role.id, permission.id from role, permission returning role_id
			)
			insert into user_roles (user_id, role_id)
			select unnest(array[${PERMITTED_ID}, ${DEACTIVATED_ID}]), role_id from mapping
		`)
		await db.execute(sql`
			insert into pisocamp_account_state (account_id, status, reason)
			values (${DEACTIVATED_ID}, 'deactivated', 'CM7 ordering fixture')
		`)
		await db.execute(sql`
			insert into content_item (id, content_type, status, current_working_version_id,
				created_by, last_edited_by, created_at, updated_at)
			values (${ITEM_ID}, 'advisory', 'draft', null, ${PERMITTED_ID}, ${PERMITTED_ID}, ${now}, ${now})
		`)
		await db.execute(sql`
			insert into content_version (id, item_id, version_no, status, content_type, title, summary,
				body, created_by, created_at)
			values (${VERSION_ID}, ${ITEM_ID}, 1, 'draft', 'advisory', 'Handle banknotes with care',
				'Draft advisory copy.', 'Draft body copy.', ${PERMITTED_ID}, ${now})
		`)
		await db.execute(sql`
			insert into audit_log (domain, action, outcome, actor_id, target_type, target_id, new_value)
			values ('content', 'content.create', 'success', ${PERMITTED_ID}, 'content_item', ${ITEM_ID}, '{}'::jsonb)
		`)
	})

	afterAll(async () => {
		if (app) await app.close()
		await db.$client.end()
	})

	it("lets a holder of content.audit.view read the trail without writing to it", async () => {
		const before = await db.select().from(auditLog)

		const response = await agent
			.get("/cm7-audit/history")
			.set("x-cm7-user", PERMITTED_ID)
			.expect(200)

		expect((response.body as { total: number }).total).toBe(1)
		// Reading history must not change history.
		expect(await db.select().from(auditLog)).toEqual(before)
	})

	it("denies a caller without content.audit.view and audits the denial", async () => {
		await agent.get("/cm7-audit/history").set("x-cm7-user", DENIED_ID).expect(403)

		const rows = await db.select().from(auditLog)
		expect(rows).toHaveLength(2)
		expect(rows[1]).toMatchObject({
			domain: "rbac",
			action: "permission_denied",
			outcome: "denied",
			actorId: DENIED_ID,
			targetId: "Cm7AuditAuthorizationController.history",
		})
	})

	it("rejects a deactivated holder before permission resolution", async () => {
		await agent.get("/cm7-audit/history").set("x-cm7-user", DEACTIVATED_ID).expect(401)

		expect(await db.select().from(auditLog)).toHaveLength(1)
	})
})
