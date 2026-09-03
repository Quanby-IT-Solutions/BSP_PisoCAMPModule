import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"

import type {
	ListPisoCampAccountsInput,
	ListPisoCampAccountsOutput,
	PisoCampAccount,
	SetPisoCampAccountStatusInput,
} from "@repo/contracts/pisocamp-account"
import { pisoCampAccountState, roles, sessions, userRoles, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

@Injectable()
export class PisoCampAccountService {
	constructor(private readonly auditService: AuditService) {}

	/**
	 * Accounts with their status, searchable and paged.
	 *
	 * A separate query from the RBAC user list rather than a widening of it:
	 * that one answers "who holds which role" for `users:read`, this one answers
	 * "who can still sign in" for `admin.accounts.manage`, and they are paged,
	 * filtered and permissioned differently.
	 */
	async list(input: ListPisoCampAccountsInput): Promise<ListPisoCampAccountsOutput> {
		const filters: SQL[] = []
		if (input.search) {
			const pattern = `%${input.search}%`
			filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!)
		}
		if (input.status === "deactivated") {
			filters.push(eq(pisoCampAccountState.status, "deactivated"))
		}
		if (input.status === "active") {
			// An account with no row has never been touched, and is active. A
			// plain equality would hide every account nobody has ever managed.
			filters.push(
				or(
					sql`${pisoCampAccountState.status} is null`,
					eq(pisoCampAccountState.status, "active")
				)!
			)
		}
		const where = filters.length === 0 ? undefined : and(...filters)

		const [total] = await db
			.select({ value: count() })
			.from(users)
			.leftJoin(pisoCampAccountState, eq(pisoCampAccountState.accountId, users.id))
			.where(where)

		const rows = await db
			.select({
				id: users.id,
				name: users.name,
				email: users.email,
				status: pisoCampAccountState.status,
				reason: pisoCampAccountState.reason,
				statusChangedAt: pisoCampAccountState.updatedAt,
			})
			.from(users)
			.leftJoin(pisoCampAccountState, eq(pisoCampAccountState.accountId, users.id))
			.where(where)
			.orderBy(desc(pisoCampAccountState.updatedAt), users.email)
			.limit(input.limit)
			.offset((input.page - 1) * input.limit)

		const rolesByUser = await this.rolesFor(rows.map(row => row.id))

		return {
			accounts: rows.map(row => this.toAccount(row, rolesByUser.get(row.id) ?? [])),
			total: total?.value ?? 0,
			page: input.page,
			limit: input.limit,
		}
	}

	/**
	 * Activate or deactivate one account.
	 *
	 * The status, the session invalidation and the audit entry commit together:
	 * an account recorded as deactivated whose sessions survived would still be
	 * signed in, and a lock-out nobody recorded is one nobody can answer for.
	 */
	async setStatus(
		input: SetPisoCampAccountStatusInput & { actorId: string }
	): Promise<PisoCampAccount> {
		// Locking yourself out mid-request leaves nobody able to undo it, and the
		// admin who did it cannot even reach the screen to try.
		if (input.accountId === input.actorId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "You cannot change the status of your own account",
			})
		}

		const [account] = await db
			.select({ id: users.id, name: users.name, email: users.email })
			.from(users)
			.where(eq(users.id, input.accountId))
		if (!account) {
			throw new ORPCError("NOT_FOUND", { message: "Account not found" })
		}

		const reason = input.status === "deactivated" ? input.reason : null

		return databaseTransactionContext.transaction(async tx => {
			const [current] = await tx
				.select({ status: pisoCampAccountState.status, reason: pisoCampAccountState.reason })
				.from(pisoCampAccountState)
				.where(eq(pisoCampAccountState.accountId, input.accountId))
				.for("update")
			const before = current?.status ?? "active"
			const now = new Date()

			await tx
				.insert(pisoCampAccountState)
				.values({
					accountId: input.accountId,
					status: input.status,
					reason,
					updatedBy: input.actorId,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: pisoCampAccountState.accountId,
					set: { status: input.status, reason, updatedBy: input.actorId, updatedAt: now },
				})

			if (input.status === "deactivated") {
				// Every open session, not just the newest: an account that keeps a
				// session is an account that keeps its access.
				await tx.delete(sessions).where(eq(sessions.userId, input.accountId))
			}

			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "account.status.update",
					actorId: input.actorId,
					targetType: "user",
					targetId: input.accountId,
					oldValue: { status: before, reason: current?.reason ?? null },
					newValue: { status: input.status, reason },
					reason,
				},
				tx
			)

			const roleNames = await this.rolesFor([input.accountId], tx)

			return this.toAccount(
				{
					id: account.id,
					name: account.name,
					email: account.email,
					status: input.status,
					reason,
					statusChangedAt: now,
				},
				roleNames.get(input.accountId) ?? []
			)
		})
	}

	private async rolesFor(
		accountIds: string[],
		tx: Pick<typeof db, "select"> = db
	): Promise<Map<string, string[]>> {
		if (accountIds.length === 0) return new Map()

		const rows = await tx
			.select({ userId: userRoles.userId, name: roles.name })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(sql`${userRoles.userId} in ${accountIds}`)

		const byUser = new Map<string, string[]>()
		for (const row of rows) {
			const list = byUser.get(row.userId) ?? []
			list.push(row.name)
			byUser.set(row.userId, list)
		}
		for (const list of byUser.values()) list.sort()
		return byUser
	}

	private toAccount(
		row: {
			id: string
			name: string
			email: string
			status: string | null
			reason: string | null
			statusChangedAt: Date | null
		},
		roleNames: string[]
	): PisoCampAccount {
		return {
			id: row.id,
			name: row.name,
			email: row.email,
			// No row means nobody has ever managed this account, which is active.
			status: row.status === "deactivated" ? "deactivated" : "active",
			reason: row.reason,
			statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
			roles: roleNames,
		}
	}
}
