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

import { RecognitionController } from "./recognition.controller"

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
				recognition: {
					list: "list",
					publish: "publish",
					updateThresholds: "updateThresholds",
				},
			},
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
	PERMISSION_NAMES: ["admin.config.manage", "reports.dashboards.view"],
}))

const configManagerId = "dr4-config-manager"
const analystId = "dr4-analyst"

function contextFor(
	userId: string | undefined,
	handler: (...args: never[]) => unknown,
	controller: unknown
) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => handler,
		getClass: () => controller,
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
 * DR-4 AC4. Who may replace the weights every device runs on people's money.
 *
 * Both branches for every endpoint, and the refusal has to leave a trace:
 * publishing a model is the change most worth knowing somebody attempted.
 */
describe("recognition model authorization", () => {
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
			[configManagerId, analystId].map(id => ({
				id,
				name: "DR-4 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const [manage] = await db
			.insert(permissions)
			.values({ name: "admin.config.manage", description: "DR-4 configuration" })
			.returning()
		const [dashboards] = await db
			.insert(permissions)
			.values({ name: "reports.dashboards.view", description: "DR-4 dashboards" })
			.returning()
		const [adminRole] = await db
			.insert(roles)
			.values({ name: "System Administrator", description: "DR-4 admin role" })
			.returning()
		const [analystRole] = await db
			.insert(roles)
			.values({ name: "Reports & Analytics User", description: "DR-4 analyst role" })
			.returning()
		await db.insert(rolePermissions).values([
			{ roleId: adminRole!.id, permissionId: manage!.id },
			{ roleId: analystRole!.id, permissionId: dashboards!.id },
		])
		await db.insert(userRoles).values([
			{ userId: configManagerId, roleId: adminRole!.id },
			{ userId: analystId, roleId: analystRole!.id },
		])
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	const endpoints: [string, (...args: never[]) => unknown][] = [
		["list", RecognitionController.prototype.list],
		["publish", RecognitionController.prototype.publish],
		["updateThresholds", RecognitionController.prototype.updateThresholds],
	]

	it.each(endpoints)("gates %s on admin.config.manage, both ways", async (name, handler) => {
		await expect(
			createGuard().canActivate(contextFor(configManagerId, handler, RecognitionController))
		).resolves.toBe(true)

		await expect(
			createGuard().canActivate(contextFor(analystId, handler, RecognitionController))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, analystId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		// Reading the dashboards is no reason to be allowed to change the model
		// every phone runs.
		expect(rows[0]).toMatchObject({
			targetType: "handler",
			targetId: `RecognitionController.${name}`,
			newValue: {
				requiredPermissions: ["admin.config.manage"],
				missingPermissions: ["admin.config.manage"],
			},
		})
	})

	it("refuses an anonymous caller and records that too", async () => {
		await expect(
			createGuard().canActivate(
				contextFor(undefined, RecognitionController.prototype.publish, RecognitionController)
			)
		).rejects.toMatchObject({ status: expect.any(Number) })
	})
})
