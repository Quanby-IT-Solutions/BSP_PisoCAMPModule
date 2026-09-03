import { Reflector } from "@nestjs/core"
import { and, eq, sql } from "drizzle-orm"

import {
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

import { PisoCampController } from "./pisocamp.controller"

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
			admin: { config: { get: "get", update: "update" } },
			config: { get: "publicGet" },
			consent: { get: "consentGet", record: "consentRecord" },
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => () => undefined,
	Session: () => () => undefined,
	Req: () => () => undefined,
}))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["admin.config.manage", "reports.dashboards.view"],
}))

const permittedId = "gm4-config-manager"
const deniedId = "gm4-dashboard-reader"
const deactivatedId = "gm4-deactivated-manager"

function contextFor(userId: string | undefined, handler: (...args: never[]) => unknown) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => handler,
		getClass: () => PisoCampController,
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
 * GM-4 AC6, and F2's gate proven rather than assumed.
 *
 * The configuration handlers already declared `admin.config.manage`, but only
 * the declaration was tested. GM-4 turns a user-facing feature on and off
 * through that gate, so the refusal — and the record of it — is worth having.
 */
describe("module configuration authorization", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table audit_log, role_permissions, user_roles, permissions, roles,
			pisocamp_account_state, sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[permittedId, deniedId, deactivatedId].map(id => ({
				id,
				name: "GM-4 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const inserted = await db
			.insert(permissions)
			.values([
				{ name: "admin.config.manage", description: "F2 configuration" },
				{ name: "reports.dashboards.view", description: "AN-2 dashboards" },
			])
			.returning()
		const manage = inserted.find(row => row.name === "admin.config.manage")!
		const dashboards = inserted.find(row => row.name === "reports.dashboards.view")!
		const insertedRoles = await db
			.insert(roles)
			.values([
				{ name: "Configuration Manager", description: "F2 role" },
				{ name: "Dashboard Reader", description: "Reads figures, changes nothing" },
			])
			.returning()
		const manager = insertedRoles.find(row => row.name === "Configuration Manager")!
		const reader = insertedRoles.find(row => row.name === "Dashboard Reader")!
		await db.insert(rolePermissions).values([
			{ roleId: manager.id, permissionId: manage.id },
			{ roleId: reader.id, permissionId: dashboards.id },
		])
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: manager.id },
			{ userId: deniedId, roleId: reader.id },
			{ userId: deactivatedId, roleId: manager.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: deactivatedId,
			status: "deactivated",
			reason: "GM-4 ordering fixture",
		})
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("gates toggling the leaderboard flag both ways, and records the refusal", async () => {
		const handler = PisoCampController.prototype.updateAdminConfig

		await expect(createGuard().canActivate(contextFor(permittedId, handler))).resolves.toBe(true)
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
			targetId: "PisoCampController.updateAdminConfig",
			newValue: {
				requiredPermissions: ["admin.config.manage"],
				missingPermissions: ["admin.config.manage"],
			},
		})
	})

	it("gates reading the configuration the same way", async () => {
		const handler = PisoCampController.prototype.getAdminConfig

		await expect(createGuard().canActivate(contextFor(permittedId, handler))).resolves.toBe(true)
		await expect(
			createGuard().canActivate(contextFor(deniedId, handler))
		).rejects.toMatchObject({ status: 403 })
	})

	it("refuses a deactivated manager before resolving the permission", async () => {
		await expect(
			createGuard().canActivate(
				contextFor(deactivatedId, PisoCampController.prototype.updateAdminConfig)
			)
		).rejects.toMatchObject({ status: 401 })
	})
})
