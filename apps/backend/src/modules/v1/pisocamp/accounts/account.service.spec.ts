import { and, eq, sql } from "drizzle-orm"

import {
	auditLog,
	pisoCampAccountState,
	roles,
	sessions,
	userRoles,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAccountService } from "./account.service"

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

const ADMIN_ID = "sa1-admin"
const ALICE_ID = "sa1-alice"
const BOB_ID = "sa1-bob"

/**
 * SA-1. Deactivation withdraws access without removing anything, so every test
 * here checks both halves: that the person can no longer get in, and that what
 * they left behind is still there.
 */
describe("SA-1 account activation and deactivation", () => {
	let accounts: PisoCampAccountService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table audit_log, pisocamp_account_state, user_roles, roles, sessions,
			accounts, users restart identity cascade
		`)
	})

	beforeEach(async () => {
		accounts = new PisoCampAccountService(new AuditService())
		await db.execute(sql`
			truncate table audit_log, pisocamp_account_state, user_roles, roles, sessions,
			accounts, users restart identity cascade
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
			{
				id: BOB_ID,
				name: "Bob Builder",
				email: "bob@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		])
		const [role] = await db
			.insert(roles)
			.values({ name: "Registered End User", description: "SA-1 fixture" })
			.returning()
		await db.insert(userRoles).values({ userId: ALICE_ID, roleId: role!.id })
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function openSession(userId: string, id: string) {
		await db.insert(sessions).values({
			id,
			token: `token-${id}`,
			userId,
			expiresAt: new Date(Date.now() + 86_400_000),
		})
	}

	describe("AC1 — deactivating sets the status, ends the sessions and is audited", () => {
		it("records the status, the reason and who did it", async () => {
			const result = await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			expect(result).toMatchObject({
				id: ALICE_ID,
				email: "alice@example.test",
				status: "deactivated",
				reason: "Left the organisation",
				roles: ["Registered End User"],
			})
			const [state] = await db
				.select()
				.from(pisoCampAccountState)
				.where(eq(pisoCampAccountState.accountId, ALICE_ID))
			expect(state).toMatchObject({
				status: "deactivated",
				reason: "Left the organisation",
				updatedBy: ADMIN_ID,
			})
		})

		it("ends every open session, not merely the newest", async () => {
			await openSession(ALICE_ID, "alice-phone")
			await openSession(ALICE_ID, "alice-laptop")
			await openSession(BOB_ID, "bob-phone")

			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			// An account that keeps a session is an account that keeps its access.
			const remaining = await db.select().from(sessions)
			expect(remaining.map(row => row.id)).toEqual(["bob-phone"])
		})

		it("audits the change with what it was and what it became", async () => {
			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			const rows = await db
				.select()
				.from(auditLog)
				.where(
					and(
						eq(auditLog.action, "account.status.update"),
						eq(auditLog.targetId, ALICE_ID)
					)
				)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				domain: "pisocamp",
				actorId: ADMIN_ID,
				targetType: "user",
				outcome: "success",
				reason: "Left the organisation",
			})
			expect(rows[0]?.oldValue).toMatchObject({ status: "active" })
			expect(rows[0]?.newValue).toMatchObject({
				status: "deactivated",
				reason: "Left the organisation",
			})
		})

		it("refuses to change the status of the account making the request", async () => {
			// Locking yourself out mid-request leaves nobody able to undo it.
			await expect(
				accounts.setStatus({
					accountId: ADMIN_ID,
					status: "deactivated",
					reason: "Testing",
					actorId: ADMIN_ID,
				})
			).rejects.toMatchObject({ message: expect.stringContaining("your own account") })

			expect(await db.select().from(pisoCampAccountState)).toHaveLength(0)
		})

		it("refuses an account that does not exist, and records nothing", async () => {
			await expect(
				accounts.setStatus({
					accountId: "nobody",
					status: "deactivated",
					reason: "Testing",
					actorId: ADMIN_ID,
				})
			).rejects.toMatchObject({ code: "NOT_FOUND" })

			expect(await db.select().from(auditLog)).toHaveLength(0)
		})
	})

	describe("AC2 — a deactivated account is refused registered-only access", () => {
		it("is no longer active as far as the guard is concerned", async () => {
			const access = new AccountAccessService()
			await expect(access.isActive(ALICE_ID)).resolves.toBe(true)

			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			// RF-4's short-circuit reads this, so every admin endpoint refuses
			// them without any of them needing to know about SA-1.
			await expect(access.isActive(ALICE_ID)).resolves.toBe(false)
			await expect(access.isActive(BOB_ID)).resolves.toBe(true)
		})
	})

	describe("AC3 — history is retained", () => {
		it("keeps the account row, its roles and its audit trail", async () => {
			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			// Deactivation is not deletion: SA-7 owns that, and a lock-out that
			// erased the person's history would destroy the evidence of what they
			// did before it.
			const [user] = await db.select().from(users).where(eq(users.id, ALICE_ID))
			expect(user).toMatchObject({ email: "alice@example.test" })
			const assignments = await db
				.select()
				.from(userRoles)
				.where(eq(userRoles.userId, ALICE_ID))
			expect(assignments).toHaveLength(1)
			expect(await db.select().from(auditLog)).toHaveLength(1)
		})
	})

	describe("AC4 — reactivation restores access and is audited", () => {
		it("returns the account to active and clears the reason", async () => {
			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			const result = await accounts.setStatus({
				accountId: ALICE_ID,
				status: "active",
				actorId: ADMIN_ID,
			})

			// The reason belonged to a lock-out that is over; the audit trail
			// keeps it, the current row does not carry it forward.
			expect(result).toMatchObject({ status: "active", reason: null })
			await expect(new AccountAccessService().isActive(ALICE_ID)).resolves.toBe(true)
		})

		it("audits the restoration separately from the withdrawal", async () => {
			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})
			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "active",
				actorId: ADMIN_ID,
			})

			const rows = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.targetId, ALICE_ID))
				.orderBy(auditLog.id)
			expect(rows).toHaveLength(2)
			expect(rows[1]?.oldValue).toMatchObject({ status: "deactivated" })
			expect(rows[1]?.newValue).toMatchObject({ status: "active", reason: null })
		})
	})

	describe("the account list", () => {
		it("reports an account nobody has ever managed as active", async () => {
			const page = await accounts.list({ page: 1, limit: 20 })

			expect(page.total).toBe(3)
			// No row is not "unknown": it is an account nothing has been done to.
			expect(page.accounts.every(account => account.status === "active")).toBe(true)
			expect(page.accounts.find(a => a.id === ALICE_ID)?.roles).toEqual([
				"Registered End User",
			])
		})

		it("finds an account by name or by address", async () => {
			await expect(accounts.list({ search: "alice@", page: 1, limit: 20 })).resolves
				.toMatchObject({ total: 1 })
			await expect(accounts.list({ search: "Builder", page: 1, limit: 20 })).resolves
				.toMatchObject({ total: 1 })
			// Searching is case-insensitive, because nobody types an address the
			// way it was stored.
			await expect(accounts.list({ search: "ALICE", page: 1, limit: 20 })).resolves
				.toMatchObject({ total: 1 })
		})

		it("filters by status, counting the never-managed as active", async () => {
			await accounts.setStatus({
				accountId: ALICE_ID,
				status: "deactivated",
				reason: "Left the organisation",
				actorId: ADMIN_ID,
			})

			const deactivated = await accounts.list({ status: "deactivated", page: 1, limit: 20 })
			expect(deactivated.accounts.map(a => a.id)).toEqual([ALICE_ID])

			const active = await accounts.list({ status: "active", page: 1, limit: 20 })
			// Bob and the admin have no row at all; a plain equality would have
			// hidden both of them.
			expect(active.accounts.map(a => a.id).sort()).toEqual([ADMIN_ID, BOB_ID].sort())
		})

		it("pages without losing or repeating anybody", async () => {
			const first = await accounts.list({ page: 1, limit: 2 })
			const second = await accounts.list({ page: 2, limit: 2 })

			expect(first.accounts).toHaveLength(2)
			expect(second.accounts).toHaveLength(1)
			expect(first.total).toBe(3)
			const ids = [...first.accounts, ...second.accounts].map(a => a.id)
			expect(new Set(ids).size).toBe(3)
		})
	})
})
