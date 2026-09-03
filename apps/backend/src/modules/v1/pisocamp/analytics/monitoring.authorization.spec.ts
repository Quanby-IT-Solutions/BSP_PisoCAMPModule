import { Reflector } from "@nestjs/core"
import { and, eq, sql } from "drizzle-orm"

import { auditLog, permissions, rolePermissions, roles, userRoles, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { RbacService } from "@/common/rbac/rbac.service"
import { RbacGuard } from "@/shared/guards/rbac.guard"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { MonitoringController } from "./monitoring.controller"

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
			monitoring: { import: "import", recordPerformanceTest: "recordPerformanceTest" },
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
	AllowAnonymous: () => () => undefined,
}))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({
	getAuth: () => ({ api: { getSession: async () => null } }),
}))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["admin.integrations.manage"],
}))

const permittedId = "an7-integrations-manager"
const deniedId = "an7-reports-only-user"

function contextFor(userId: string, handler: (...args: never[]) => unknown) {
	const request = { headers: {}, session: { user: { id: userId } }, user: { id: userId } }
	return {
		getHandler: () => handler,
		getClass: () => MonitoringController,
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

/**
 * AN-7's write side is an integration permission, not a reporting one.
 *
 * Somebody who may read the technical dashboard has no business feeding the
 * module figures from outside it, which is exactly what the denied user here
 * proves.
 */
describe("monitoring import authorization", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table audit_log, role_permissions, user_roles, permissions, roles,
			sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[permittedId, deniedId].map(id => ({
				id,
				name: "AN-7 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const [integrations] = await db
			.insert(permissions)
			.values({ name: "admin.integrations.manage", description: "AN-7 import" })
			.returning()
		const [dashboards] = await db
			.insert(permissions)
			.values({ name: "reports.dashboards.view", description: "AN-7 dashboards" })
			.returning()
		const [systemAdmin] = await db
			.insert(roles)
			.values({ name: "System Administrator", description: "AN-7 integrations role" })
			.returning()
		const [reports] = await db
			.insert(roles)
			.values({ name: "Reports & Analytics User", description: "AN-7 reports role" })
			.returning()
		await db.insert(rolePermissions).values([
			{ roleId: systemAdmin!.id, permissionId: integrations!.id },
			{ roleId: reports!.id, permissionId: dashboards!.id },
		])
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: systemAdmin!.id },
			{ userId: deniedId, roleId: reports!.id },
		])
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function bothWays(handler: (...args: never[]) => unknown, targetId: string) {
		await expect(createGuard().canActivate(contextFor(permittedId, handler))).resolves.toBe(
			true
		)
		await expect(
			createGuard().canActivate(contextFor(deniedId, handler))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			outcome: "denied",
			targetType: "handler",
			targetId,
			newValue: {
				requiredPermissions: ["admin.integrations.manage"],
				missingPermissions: ["admin.integrations.manage"],
			},
		})
	}

	it("gates the monitoring import on admin.integrations.manage, both ways", async () => {
		await bothWays(MonitoringController.prototype.import, "MonitoringController.import")
	})

	it("gates the performance-test entry the same way", async () => {
		await bothWays(
			MonitoringController.prototype.recordPerformanceTest,
			"MonitoringController.recordPerformanceTest"
		)
	})

	it("refuses a request with no session before writing a denial audit", async () => {
		const request = { headers: {} }
		const context = {
			getHandler: () => MonitoringController.prototype.import,
			getClass: () => MonitoringController,
			switchToHttp: () => ({ getRequest: () => request }),
		} as never

		await expect(createGuard().canActivate(context)).rejects.toMatchObject({ status: 401 })

		// Nobody to attribute a denial to, so there is nothing to record.
		const rows = await db.select().from(auditLog)
		expect(rows).toEqual([])
	})
})
