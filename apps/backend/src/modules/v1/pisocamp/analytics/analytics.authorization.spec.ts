import { Reflector } from "@nestjs/core"
import { and, eq, sql } from "drizzle-orm"

import {
	analyticsEvents,
	auditLog,
	permissions,
	pisoCampAccountState,
	rolePermissions,
	roles,
	userRoles,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { RbacService } from "@/common/rbac/rbac.service"
import { RbacGuard } from "@/shared/guards/rbac.guard"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { AnalyticsController } from "./analytics.controller"
import { AnalyticsService } from "./analytics.service"

const expectedDatabaseName = process.env.AN1_EXPECTED_DATABASE_NAME ?? "an1_task3_backend_test"

jest.mock("@orpc/nest", () => ({ Implement: () => () => undefined }))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
	implement: jest.fn(() => ({ handler: (handler: () => unknown) => handler() })),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			events: { ingest: "analyticsIngest" },
			analytics: {
				moduleEntryToday: "moduleEntryToday",
				engagement: "engagement",
				adoption: "adoption",
				retention: "retention",
				gamification: "gamification",
			},
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => () => undefined,
}))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({
	getAuth: () => ({ api: { getSession: async () => null } }),
}))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["reports.dashboards.view"],
}))

const permittedId = "an1-task3-reports-user"
const deniedId = "an1-task3-registered-user"
const deactivatedId = "an1-task3-deactivated-reports-user"

function contextFor(userId?: string, handler: () => unknown = AnalyticsController.prototype.moduleEntryToday) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => handler,
		getClass: () => AnalyticsController,
		switchToHttp: () => ({ getRequest: () => request }),
	} as never
}

function createGuard(): RbacGuard {
	const audit = new AuditService()
	return new RbacGuard(
		new Reflector(),
		new RbacService(new RbacCacheService(null), audit),
		new AccountAccessService(),
		audit
	)
}

describe("analytics summary authorization", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		const identity = await db.execute<{ databaseName: string }>(
			sql`select current_database() as "databaseName"`
		)
		expect(identity.rows[0]?.databaseName).toBe(expectedDatabaseName)

		await db.execute(sql`
			truncate table analytics_event, audit_log, role_permissions, user_roles,
			permissions, roles, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-08-31T01:00:00.000Z")
		await db.insert(users).values(
			[permittedId, deniedId, deactivatedId].map(id => ({
				id,
				name: "Task 3 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const [permission] = await db
			.insert(permissions)
			.values({ name: "reports.dashboards.view", description: "Task 3 summary access" })
			.returning()
		const [role] = await db
			.insert(roles)
			.values({ name: "Reports & Analytics", description: "Task 3 reports role" })
			.returning()
		await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id })
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: role!.id },
			{ userId: deactivatedId, roleId: role!.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: deactivatedId,
			status: "deactivated",
			reason: "Task 3 ordering fixture",
		})
		const storedEvent = {
			eventId: "79fae1c2-f515-4196-8006-5f76d420987e",
			schemaVersion: 1,
			eventName: "module_entry",
			occurredAt: new Date("2026-08-31T00:30:00.000Z"),
			subjectPseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
			sessionId: "40da258e-0374-46a6-aecd-ae24f037f83e",
			accountType: "registered",
			screen: "pisocamp_home",
			feature: "module",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "online",
			status: "completed",
			properties: { entryPoint: "navigation" },
		} as const
		await db.insert(analyticsEvents).values([
			storedEvent,
			{
				...storedEvent,
				eventId: "f6197db0-b4dc-41ba-aa97-a3c0bea0b874",
				occurredAt: new Date("2026-08-30T16:00:00.000Z"),
			},
			{
				...storedEvent,
				eventId: "901912a9-d15b-4b73-9ed5-48f0e3e8cf8b",
				occurredAt: new Date("2026-08-31T16:00:00.000Z"),
			},
			{
				...storedEvent,
				eventId: "f4e82561-4efe-4eb6-ae40-09fc0bfcccb5",
				eventName: "content_view",
				screen: "currency_detail",
				feature: "currency_education",
				properties: { logicalId: "not-a-module-entry" },
			},
		])
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("allows Reports & Analytics permission and returns the Manila-day summary", async () => {
		await expect(createGuard().canActivate(contextFor(permittedId))).resolves.toBe(true)
		await expect(
			new AnalyticsService(db).moduleEntryToday(new Date("2026-08-31T01:30:00.000Z"))
		).resolves.toEqual({
			date: "2026-08-31",
			timezone: "Asia/Manila",
			moduleEntryCount: 2,
		})
	})

	it("denies a registered user and writes one handler-targeted permission_denied audit", async () => {
		await expect(createGuard().canActivate(contextFor(deniedId))).rejects.toMatchObject({
			status: 403,
		})

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			outcome: "denied",
			targetType: "handler",
			targetId: "AnalyticsController.moduleEntryToday",
			newValue: {
				requiredPermissions: ["reports.dashboards.view"],
				missingPermissions: ["reports.dashboards.view"],
			},
		})
	})

	it("gates the engagement dashboard on the same permission, both ways", async () => {
		const engagement = AnalyticsController.prototype.engagement

		await expect(createGuard().canActivate(contextFor(permittedId, engagement))).resolves.toBe(
			true
		)
		await expect(
			createGuard().canActivate(contextFor(deniedId, engagement))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		// The denial names the handler that was refused, not the controller: an
		// audit that could not tell the two dashboards apart would be no use.
		expect(rows[0]).toMatchObject({
			targetId: "AnalyticsController.engagement",
			newValue: { missingPermissions: ["reports.dashboards.view"] },
		})
	})

	it("gates the gamification dashboard on the same permission, both ways", async () => {
		const gamification = AnalyticsController.prototype.gamification

		await expect(
			createGuard().canActivate(contextFor(permittedId, gamification))
		).resolves.toBe(true)
		await expect(
			createGuard().canActivate(contextFor(deniedId, gamification))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ targetId: "AnalyticsController.gamification" })
	})

	it("gates the survey dashboard on the same permission, both ways", async () => {
		const surveys = AnalyticsController.prototype.surveys

		await expect(createGuard().canActivate(contextFor(permittedId, surveys))).resolves.toBe(
			true
		)
		await expect(
			createGuard().canActivate(contextFor(deniedId, surveys))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ targetId: "AnalyticsController.surveys" })
	})

	it("gates the retention dashboard on the same permission, both ways", async () => {
		const retention = AnalyticsController.prototype.retention

		await expect(createGuard().canActivate(contextFor(permittedId, retention))).resolves.toBe(
			true
		)
		await expect(
			createGuard().canActivate(contextFor(deniedId, retention))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ targetId: "AnalyticsController.retention" })
	})

	it("gates the adoption dashboard on the same permission, both ways", async () => {
		const adoption = AnalyticsController.prototype.adoption

		await expect(createGuard().canActivate(contextFor(permittedId, adoption))).resolves.toBe(
			true
		)
		await expect(
			createGuard().canActivate(contextFor(deniedId, adoption))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ targetId: "AnalyticsController.adoption" })
	})

	it("rejects an unauthenticated request before any permission denial audit", async () => {
		await expect(createGuard().canActivate(contextFor())).rejects.toMatchObject({ status: 401 })
		expect(await db.select().from(auditLog)).toHaveLength(0)
	})

	it("rejects a deactivated permission holder before permission resolution can grant access", async () => {
		await expect(createGuard().canActivate(contextFor(deactivatedId))).rejects.toMatchObject({
			status: 401,
		})
		expect(await db.select().from(auditLog)).toHaveLength(0)
	})
})
