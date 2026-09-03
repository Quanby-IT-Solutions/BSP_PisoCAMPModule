import { and, eq, sql } from "drizzle-orm"

import { auditLog, permissions, rolePermissions, roles, userRoles, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { RbacService } from "@/common/rbac/rbac.service"
import { RbacAdminService } from "@/modules/v1/rbac/rbac-admin.service"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampRoleService } from "./role.service"

// The RBAC services import the contracts root, which pulls oRPC's ESM build
// into this CommonJS suite. Only these two values are read at runtime.
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["reports.dashboards.view", "content.items.edit"],
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const ADMIN_ID = "sa2-admin"
const ALICE_ID = "sa2-alice"

/**
 * SA-2. The write path is `RbacService`, which SA-2 reuses rather than
 * reimplements, so these tests check the difference SA-2 actually computes and
 * that the guards it inherited still fire.
 */
describe("SA-2 role assignment", () => {
	let service: PisoCampRoleService
	let rbacService: RbacService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table audit_log, role_permissions, user_roles, permissions, roles,
			pisocamp_account_state, sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values([
			{
				id: ADMIN_ID,
				name: "Ada Admin",
				email: "ada@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: ALICE_ID,
				name: "Alice Reader",
				email: "alice@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		])
		const insertedPermissions = await db
			.insert(permissions)
			.values([
				{ name: "reports.dashboards.view", description: "Dashboards" },
				{ name: "content.items.edit", description: "Content" },
			])
			.returning()
		const insertedRoles = await db
			.insert(roles)
			.values([
				{ name: "Reports & Analytics User", description: "Reads dashboards" },
				{ name: "Content Administrator", description: "Edits content" },
				{ name: "Registered End User", description: "Nothing in particular" },
			])
			.returning()
		const reports = insertedRoles.find(r => r.name === "Reports & Analytics User")!
		const content = insertedRoles.find(r => r.name === "Content Administrator")!
		await db.insert(rolePermissions).values([
			{
				roleId: reports.id,
				permissionId: insertedPermissions.find(p => p.name === "reports.dashboards.view")!.id,
			},
			{
				roleId: content.id,
				permissionId: insertedPermissions.find(p => p.name === "content.items.edit")!.id,
			},
		])

		const audit = new AuditService()
		const cache = new RbacCacheService(null)
		rbacService = new RbacService(cache, audit)
		service = new PisoCampRoleService(
			rbacService,
			new RbacAdminService(rbacService, cache, audit)
		)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function rolesOf(userId: string) {
		const rows = await db
			.select({ name: roles.name })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(eq(userRoles.userId, userId))
		return rows.map(r => r.name).sort()
	}

	describe("AC1 — assigning a role updates permissions immediately, and is audited", () => {
		it("grants the role and reports what changed", async () => {
			const result = await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User"],
				actorId: ADMIN_ID,
			})

			expect(result).toEqual({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User"],
				assigned: ["Reports & Analytics User"],
				revoked: [],
			})
			expect(await rolesOf(ALICE_ID)).toEqual(["Reports & Analytics User"])
		})

		it("makes the permission resolvable straight away", async () => {
			await expect(rbacService.hasPermission(ALICE_ID, "reports.dashboards.view")).resolves.toBe(
				false
			)

			await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User"],
				actorId: ADMIN_ID,
			})

			// "Immediately" means the next resolution, not after a cache lapses:
			// RbacService invalidates the entry once the change has committed.
			await expect(
				new RbacService(new RbacCacheService(null), new AuditService()).hasPermission(
					ALICE_ID,
					"reports.dashboards.view"
				)
			).resolves.toBe(true)
		})

		it("audits the grant", async () => {
			await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User"],
				actorId: ADMIN_ID,
			})

			const rows = await db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.action, "role.assign"), eq(auditLog.targetId, ALICE_ID)))
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ actorId: ADMIN_ID, targetType: "user" })
		})
	})

	describe("AC2 — revoking removes the permission from the next request", () => {
		it("revokes what is no longer in the set, and audits it", async () => {
			await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User", "Content Administrator"],
				actorId: ADMIN_ID,
			})

			const result = await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Content Administrator"],
				actorId: ADMIN_ID,
			})

			expect(result).toMatchObject({
				roles: ["Content Administrator"],
				assigned: [],
				revoked: ["Reports & Analytics User"],
			})
			await expect(
				new RbacService(new RbacCacheService(null), new AuditService()).hasPermission(
					ALICE_ID,
					"reports.dashboards.view"
				)
			).resolves.toBe(false)

			const rows = await db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.action, "role.remove"), eq(auditLog.targetId, ALICE_ID)))
			expect(rows).toHaveLength(1)
		})

		it("does nothing at all when the set is already what was asked for", async () => {
			await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Content Administrator"],
				actorId: ADMIN_ID,
			})
			await db.delete(auditLog)

			const result = await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Content Administrator"],
				actorId: ADMIN_ID,
			})

			// Re-sending the same answer is not a change, and an audit trail full
			// of no-ops is one nobody reads.
			expect(result).toMatchObject({ assigned: [], revoked: [] })
			expect(await db.select().from(auditLog)).toHaveLength(0)
		})

		it("clears every role when the set is empty", async () => {
			await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User", "Content Administrator"],
				actorId: ADMIN_ID,
			})

			const result = await service.setUserRoles({
				userId: ALICE_ID,
				roles: [],
				actorId: ADMIN_ID,
			})

			expect(result.revoked).toEqual(["Content Administrator", "Reports & Analytics User"])
			expect(await rolesOf(ALICE_ID)).toEqual([])
		})
	})

	describe("AC3 — the role list shows the permission keys each role carries", () => {
		it("lists every role with its keys and how many people hold it", async () => {
			await service.setUserRoles({
				userId: ALICE_ID,
				roles: ["Reports & Analytics User"],
				actorId: ADMIN_ID,
			})

			const { roles: catalogue } = await service.list()

			expect(catalogue.map(role => role.name)).toEqual([
				"Content Administrator",
				"Registered End User",
				"Reports & Analytics User",
			])
			expect(catalogue.find(role => role.name === "Reports & Analytics User")).toMatchObject({
				permissions: ["reports.dashboards.view"],
				userCount: 1,
			})
			// A role that carries nothing says so, rather than being left out.
			expect(catalogue.find(role => role.name === "Registered End User")).toMatchObject({
				permissions: [],
				userCount: 0,
			})
		})
	})

	describe("refusals", () => {
		it("refuses an unknown role by name, and changes nothing", async () => {
			await expect(
				service.setUserRoles({
					userId: ALICE_ID,
					roles: ["Reports & Analytics User", "Emperor"],
					actorId: ADMIN_ID,
				})
			).rejects.toMatchObject({ message: expect.stringContaining("Emperor") })

			// Nothing is applied: half an assignment is worse than none, because
			// the screen would report the whole of it.
			expect(await rolesOf(ALICE_ID)).toEqual([])
		})

		it("refuses an account that does not exist", async () => {
			await expect(
				service.setUserRoles({ userId: "nobody", roles: [], actorId: ADMIN_ID })
			).rejects.toMatchObject({ code: "NOT_FOUND" })
		})

		it("still refuses to grant Admin to somebody who is not one", async () => {
			await db.insert(roles).values({ name: "Admin", description: "Everything" })

			// The guard lives in RbacService. Re-implementing the write here
			// would have dropped it, so this asserts SA-2 really does go through
			// that path rather than around it.
			await expect(
				service.setUserRoles({ userId: ALICE_ID, roles: ["Admin"], actorId: ADMIN_ID })
			).rejects.toMatchObject({ code: "FORBIDDEN" })
			expect(await rolesOf(ALICE_ID)).toEqual([])
		})
	})
})
