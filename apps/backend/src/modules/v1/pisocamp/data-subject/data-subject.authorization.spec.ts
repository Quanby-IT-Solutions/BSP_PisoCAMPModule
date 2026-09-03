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
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { RbacGuard } from "@/shared/guards/rbac.guard"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampDataSubjectController } from "./data-subject.controller"

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
			me: { exportMine: "exportMine" },
			admin: { dataSubject: { delete: "delete" } },
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({ Session: () => () => undefined }))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["admin.accounts.manage", "admin.audit.view"],
}))

const permittedId = "sa7-account-manager"
const deniedId = "sa7-auditor"

function contextFor(userId: string | undefined, handler: (...args: never[]) => unknown) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => handler,
		getClass: () => PisoCampDataSubjectController,
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
 * SA-7 AC4, and the line between the two handlers.
 *
 * Deleting somebody's data is an administrator's act; asking for your own copy
 * is not, and requiring a permission for it would make a right you can only
 * exercise by asking somebody else.
 */
describe("data subject authorization", () => {
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
			[permittedId, deniedId].map(id => ({
				id,
				name: "SA-7 fixture",
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
				{ name: "admin.audit.view", description: "SA-4 audit viewer" },
			])
			.returning()
		const manage = inserted.find(row => row.name === "admin.accounts.manage")!
		const view = inserted.find(row => row.name === "admin.audit.view")!
		const insertedRoles = await db
			.insert(roles)
			.values([
				{ name: "Account Manager", description: "SA-7 role" },
				{ name: "Auditor", description: "Reads the trail, deletes nothing" },
			])
			.returning()
		const manager = insertedRoles.find(row => row.name === "Account Manager")!
		const auditor = insertedRoles.find(row => row.name === "Auditor")!
		await db.insert(rolePermissions).values([
			{ roleId: manager.id, permissionId: manage.id },
			{ roleId: auditor.id, permissionId: view.id },
		])
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: manager.id },
			{ userId: deniedId, roleId: auditor.id },
		])
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("gates deletion on admin.accounts.manage, both ways", async () => {
		const handler = PisoCampDataSubjectController.prototype.delete

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
			targetId: "PisoCampDataSubjectController.delete",
			newValue: {
				requiredPermissions: ["admin.accounts.manage"],
				missingPermissions: ["admin.accounts.manage"],
			},
		})
	})

	it("asks for no permission at all to export your own data", () => {
		// A right you have to ask somebody else to exercise for you is a weaker
		// right, so this handler carries no permission requirement.
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				PisoCampDataSubjectController.prototype.exportMine
			)
		).toBeUndefined()
	})

	it("still requires a session for the export", () => {
		// Authentication is the auth guard's job, and it lets through only what
		// is marked anonymous. Neither handler here is, so a request with no
		// session never reaches either of them.
		expect(
			Reflect.getMetadata("PUBLIC", PisoCampDataSubjectController.prototype.exportMine)
		).not.toBe(true)
		expect(
			Reflect.getMetadata("PUBLIC", PisoCampDataSubjectController.prototype.delete)
		).not.toBe(true)
	})
})
