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

import { PisoCampAuditViewerController } from "./audit-viewer.controller"

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
	v1: { pisocamp: { admin: { audit: { list: "list" } } } },
}))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["admin.audit.view", "admin.accounts.manage"],
}))

const permittedId = "sa4-auditor"
const deniedId = "sa4-account-manager"
const deactivatedId = "sa4-deactivated-auditor"

function contextFor(userId: string | undefined) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => PisoCampAuditViewerController.prototype.list,
		getClass: () => PisoCampAuditViewerController,
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
 * SA-4 AC4. Both branches.
 *
 * The denied user deliberately holds `admin.accounts.manage`: being trusted to
 * lock somebody out is not being trusted to read the record of who else did.
 */
describe("audit viewer authorization", () => {
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
				name: "SA-4 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const inserted = await db
			.insert(permissions)
			.values([
				{ name: "admin.audit.view", description: "SA-4 audit viewer" },
				{ name: "admin.accounts.manage", description: "SA-1 account management" },
			])
			.returning()
		const view = inserted.find(row => row.name === "admin.audit.view")!
		const manage = inserted.find(row => row.name === "admin.accounts.manage")!
		const insertedRoles = await db
			.insert(roles)
			.values([
				{ name: "Auditor", description: "SA-4 role" },
				{ name: "Account Manager", description: "Manages accounts, reads no trail" },
			])
			.returning()
		const auditor = insertedRoles.find(row => row.name === "Auditor")!
		const manager = insertedRoles.find(row => row.name === "Account Manager")!
		await db.insert(rolePermissions).values([
			{ roleId: auditor.id, permissionId: view.id },
			{ roleId: manager.id, permissionId: manage.id },
		])
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: auditor.id },
			{ userId: deniedId, roleId: manager.id },
			{ userId: deactivatedId, roleId: auditor.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: deactivatedId,
			status: "deactivated",
			reason: "SA-4 ordering fixture",
		})
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("gates the viewer both ways, and records the refusal in the trail itself", async () => {
		await expect(createGuard().canActivate(contextFor(permittedId))).resolves.toBe(true)
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
			targetId: "PisoCampAuditViewerController.list",
			newValue: {
				requiredPermissions: ["admin.audit.view"],
				missingPermissions: ["admin.audit.view"],
			},
		})
	})

	it("refuses a deactivated auditor before resolving the permission", async () => {
		await expect(createGuard().canActivate(contextFor(deactivatedId))).rejects.toMatchObject({
			status: 401,
		})
	})

	it("refuses an unauthenticated request", async () => {
		await expect(createGuard().canActivate(contextFor(undefined))).rejects.toMatchObject({
			status: 401,
		})
	})
})
