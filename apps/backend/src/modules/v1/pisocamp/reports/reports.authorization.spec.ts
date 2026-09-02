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

import { ReportsController } from "./reports.controller"

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
				reports: {
					definitions: "definitions",
					generate: "generate",
					runs: "runs",
				},
			},
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Admin",
	PERMISSION_NAMES: ["reports.reports.generate", "reports.dashboards.view"],
}))

const permittedId = "an8-generate-user"
const deniedId = "an8-dashboard-only-user"
const deactivatedId = "an8-deactivated-user"

function contextFor(userId: string | undefined, handler: (...args: never[]) => unknown) {
	const request = {
		headers: {},
		...(userId ? { session: { user: { id: userId } }, user: { id: userId } } : {}),
	}
	return {
		getHandler: () => handler,
		getClass: () => ReportsController,
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
 * AN-8 AC5. Both branches, on every handler.
 *
 * The denied user deliberately holds `reports.dashboards.view`: being allowed
 * to read a dashboard is not being allowed to generate a report, and a test
 * that denied somebody with no permissions at all would not have shown that.
 */
describe("report generation authorization", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table report_run, report_definition, audit_log, role_permissions, user_roles,
			permissions, roles, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-08-31T01:00:00.000Z")
		await db.insert(users).values(
			[permittedId, deniedId, deactivatedId].map(id => ({
				id,
				name: "AN-8 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const inserted = await db
			.insert(permissions)
			.values([
				{ name: "reports.reports.generate", description: "AN-8 generation" },
				{ name: "reports.dashboards.view", description: "AN-2 dashboards" },
			])
			.returning()
		const generate = inserted.find(row => row.name === "reports.reports.generate")!
		const dashboards = inserted.find(row => row.name === "reports.dashboards.view")!
		const insertedRoles = await db
			.insert(roles)
			.values([
				{ name: "Report Generator", description: "AN-8 role" },
				{ name: "Dashboard Reader", description: "Dashboards but not reports" },
			])
			.returning()
		const generator = insertedRoles.find(row => row.name === "Report Generator")!
		const reader = insertedRoles.find(row => row.name === "Dashboard Reader")!
		await db.insert(rolePermissions).values([
			{ roleId: generator.id, permissionId: generate.id },
			{ roleId: reader.id, permissionId: dashboards.id },
		])
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: generator.id },
			{ userId: deniedId, roleId: reader.id },
			{ userId: deactivatedId, roleId: generator.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: deactivatedId,
			status: "deactivated",
			reason: "AN-8 ordering fixture",
		})
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	const handlers = {
		definitions: "ReportsController.definitions",
		generate: "ReportsController.generate",
		runs: "ReportsController.runs",
	} as const

	async function bothWays(name: keyof typeof handlers) {
		const handler = ReportsController.prototype[name]

		await expect(createGuard().canActivate(contextFor(permittedId, handler))).resolves.toBe(true)
		await expect(
			createGuard().canActivate(contextFor(deniedId, handler))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		// The denial names the handler that was refused, not the controller.
		expect(rows[0]).toMatchObject({
			domain: "rbac",
			outcome: "denied",
			targetType: "handler",
			targetId: handlers[name],
			newValue: {
				requiredPermissions: ["reports.reports.generate"],
				missingPermissions: ["reports.reports.generate"],
			},
		})
	}

	it("gates the definition list both ways", async () => {
		await bothWays("definitions")
	})

	it("gates report generation both ways", async () => {
		await bothWays("generate")
	})

	it("gates the run history both ways", async () => {
		await bothWays("runs")
	})

	it("refuses a deactivated holder of the permission before resolving it", async () => {
		// RF-4: a deactivated account is not a caller, so the refusal is 401
		// rather than 403 — the permission it holds is never reached.
		await expect(
			createGuard().canActivate(contextFor(deactivatedId, ReportsController.prototype.generate))
		).rejects.toMatchObject({ status: 401 })
	})

	it("refuses an unauthenticated request", async () => {
		await expect(
			createGuard().canActivate(contextFor(undefined, ReportsController.prototype.generate))
		).rejects.toMatchObject({ status: 401 })
	})
})
