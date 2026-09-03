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

import { PisoCampAccountsController } from "./accounts.controller"

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
			admin: {
				accounts: { list: "list", setStatus: "setStatus" },
				roles: { list: "listRoles", setUserRoles: "setUserRoles" },
			},
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({ Session: () => () => undefined }))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["admin.accounts.manage", "admin.roles.assign", "users:read"],
}))

const permittedId = "sa1-account-manager"
const deniedId = "sa1-directory-reader"
const deactivatedId = "sa1-deactivated-manager"

function contextFor(userId: string | undefined, handler: (...args: never[]) => unknown) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => handler,
		getClass: () => PisoCampAccountsController,
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
 * SA-1 AC5. Both branches, on both handlers.
 *
 * The denied user deliberately holds `users:read`: being able to see the user
 * directory is not being able to lock somebody out of it.
 */
describe("account management authorization", () => {
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
				name: "SA-1 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const inserted = await db
			.insert(permissions)
			.values([
				{ name: "admin.accounts.manage", description: "SA-1 account management" },
				{ name: "admin.roles.assign", description: "SA-2 role assignment" },
				{ name: "users:read", description: "Directory read" },
			])
			.returning()
		const manage = inserted.find(row => row.name === "admin.accounts.manage")!
		const assign = inserted.find(row => row.name === "admin.roles.assign")!
		const read = inserted.find(row => row.name === "users:read")!
		const insertedRoles = await db
			.insert(roles)
			.values([
				{ name: "Account Manager", description: "SA-1 role" },
				{ name: "Directory Reader", description: "Sees users, manages nobody" },
			])
			.returning()
		const manager = insertedRoles.find(row => row.name === "Account Manager")!
		const reader = insertedRoles.find(row => row.name === "Directory Reader")!
		await db.insert(rolePermissions).values([
			{ roleId: manager.id, permissionId: manage.id },
			{ roleId: manager.id, permissionId: assign.id },
			{ roleId: reader.id, permissionId: read.id },
		])
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: manager.id },
			{ userId: deniedId, roleId: reader.id },
			{ userId: deactivatedId, roleId: manager.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: deactivatedId,
			status: "deactivated",
			reason: "SA-1 ordering fixture",
		})
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	const handlers = {
		list: ["PisoCampAccountsController.list", "admin.accounts.manage"],
		setStatus: ["PisoCampAccountsController.setStatus", "admin.accounts.manage"],
		listRoles: ["PisoCampAccountsController.listRoles", "admin.roles.assign"],
		setUserRoles: ["PisoCampAccountsController.setUserRoles", "admin.roles.assign"],
	} as const

	async function bothWays(name: keyof typeof handlers) {
		const handler = PisoCampAccountsController.prototype[name]

		await expect(createGuard().canActivate(contextFor(permittedId, handler))).resolves.toBe(true)
		await expect(
			createGuard().canActivate(contextFor(deniedId, handler))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		const [targetId, permission] = handlers[name]
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			outcome: "denied",
			targetType: "handler",
			targetId,
			newValue: {
				requiredPermissions: [permission],
				missingPermissions: [permission],
			},
		})
	}

	it("gates the account list both ways", async () => {
		await bothWays("list")
	})

	it("gates the status change both ways", async () => {
		await bothWays("setStatus")
	})

	it("gates the role list both ways", async () => {
		await bothWays("listRoles")
	})

	it("gates role assignment both ways", async () => {
		// SA-2's permission, not SA-1's: seeing the directory and changing who
		// can do what are separate privileges, and the denial names which one.
		await bothWays("setUserRoles")
	})

	it("refuses a deactivated account manager before resolving the permission", async () => {
		// RF-4: the deactivation SA-1 writes is the same one that short-circuits
		// here, so an administrator who is locked out cannot unlock themselves.
		await expect(
			createGuard().canActivate(
				contextFor(deactivatedId, PisoCampAccountsController.prototype.setStatus)
			)
		).rejects.toMatchObject({ status: 401 })
	})

	it("refuses an unauthenticated request", async () => {
		await expect(
			createGuard().canActivate(
				contextFor(undefined, PisoCampAccountsController.prototype.list)
			)
		).rejects.toMatchObject({ status: 401 })
	})
})
