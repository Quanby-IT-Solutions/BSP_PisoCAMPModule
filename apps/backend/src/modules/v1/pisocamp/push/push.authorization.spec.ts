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

import { NotificationsController, PushController } from "./push.controller"

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
			push: {
				status: "status",
				subscribe: "subscribe",
				unsubscribe: "unsubscribe",
				receipt: "receipt",
			},
			admin: { notifications: { send: "send", metrics: "metrics" } },
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
	PERMISSION_NAMES: ["admin.notifications.send", "reports.dashboards.view"],
}))

const senderId = "sa5-notification-sender"
const readerId = "sa5-dashboard-reader"

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
 * SA-5's three levels of access.
 *
 * Controlling notifications to your own device needs a session and nothing
 * more; sending to everybody needs `admin.notifications.send`; and reading the
 * rates is the same reporting permission as every other dashboard.
 */
describe("push authorization", () => {
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
			[senderId, readerId].map(id => ({
				id,
				name: "SA-5 fixture",
				email: `${id}@test.local`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		const [send] = await db
			.insert(permissions)
			.values({ name: "admin.notifications.send", description: "SA-5 send" })
			.returning()
		const [dashboards] = await db
			.insert(permissions)
			.values({ name: "reports.dashboards.view", description: "SA-5 dashboards" })
			.returning()
		const [sendRole] = await db
			.insert(roles)
			.values({ name: "System Administrator", description: "SA-5 sender role" })
			.returning()
		const [reportRole] = await db
			.insert(roles)
			.values({ name: "Reports & Analytics User", description: "SA-5 reports role" })
			.returning()
		await db.insert(rolePermissions).values([
			{ roleId: sendRole!.id, permissionId: send!.id },
			{ roleId: reportRole!.id, permissionId: dashboards!.id },
		])
		await db.insert(userRoles).values([
			{ userId: senderId, roleId: sendRole!.id },
			{ userId: readerId, roleId: reportRole!.id },
		])
	})

	beforeEach(async () => {
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("gates sending on admin.notifications.send, both ways", async () => {
		const send = NotificationsController.prototype.send

		await expect(
			createGuard().canActivate(contextFor(senderId, send, NotificationsController))
		).resolves.toBe(true)
		await expect(
			createGuard().canActivate(contextFor(readerId, send, NotificationsController))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, readerId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		// Reading the rates is no reason to be allowed to send to everybody.
		expect(rows[0]).toMatchObject({
			targetType: "handler",
			targetId: "NotificationsController.send",
			newValue: {
				requiredPermissions: ["admin.notifications.send"],
				missingPermissions: ["admin.notifications.send"],
			},
		})
	})

	it("gates the rates on reports.dashboards.view, both ways", async () => {
		const metrics = NotificationsController.prototype.metrics

		await expect(
			createGuard().canActivate(contextFor(readerId, metrics, NotificationsController))
		).resolves.toBe(true)
		await expect(
			createGuard().canActivate(contextFor(senderId, metrics, NotificationsController))
		).rejects.toMatchObject({ status: 403 })

		const rows = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, senderId), eq(auditLog.action, "permission_denied")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ targetId: "NotificationsController.metrics" })
	})

	it("asks for no permission at all to control your own subscription", async () => {
		for (const handler of [
			PushController.prototype.status,
			PushController.prototype.subscribe,
			PushController.prototype.unsubscribe,
			PushController.prototype.receipt,
		]) {
			await expect(
				createGuard().canActivate(contextFor(readerId, handler, PushController))
			).resolves.toBe(true)
		}

		// A permission here would mean asking an administrator to be allowed to
		// control notifications to your own device.
		await expect(db.select().from(auditLog)).resolves.toEqual([])
	})

	it("still requires a session for every subscription handler", () => {
		// Authentication is the auth guard's job, and it lets through only what
		// is marked anonymous. None of these are, so a request with no session
		// never reaches them.
		for (const handler of [
			PushController.prototype.status,
			PushController.prototype.subscribe,
			PushController.prototype.unsubscribe,
			PushController.prototype.receipt,
		]) {
			expect(Reflect.getMetadata("PUBLIC", handler)).not.toBe(true)
		}
	})
})
