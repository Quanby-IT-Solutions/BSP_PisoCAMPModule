import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import type {
	ListPisoCampRolesOutput,
	SetPisoCampUserRolesInput,
	SetPisoCampUserRolesOutput,
} from "@repo/contracts/pisocamp-role"
import { roles, userRoles, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { RbacService } from "@/common/rbac/rbac.service"
import { RbacAdminService } from "@/modules/v1/rbac/rbac-admin.service"

@Injectable()
export class PisoCampRoleService {
	constructor(
		private readonly rbacService: RbacService,
		private readonly rbacAdminService: RbacAdminService
	) {}

	/**
	 * The roles that can be assigned, with the permission keys each carries.
	 *
	 * Straight from the RBAC admin service rather than a second query: the role
	 * catalogue is one thing, and two readings of it that could disagree would
	 * be worse than none.
	 */
	async list(): Promise<ListPisoCampRolesOutput> {
		const catalogue = await this.rbacAdminService.listRoles()

		return {
			roles: catalogue.map(role => ({
				name: role.name,
				description: role.description ?? null,
				permissions: [...role.permissions].sort(),
				userCount: role.userCount ?? 0,
			})),
		}
	}

	/**
	 * Make an account hold exactly the roles it was given, and no others.
	 *
	 * The difference is applied through `RbacService`, one grant or revoke at a
	 * time, so every guard that service already enforces still applies: the
	 * audit entry written inside the same transaction as the change, the refusal
	 * to grant Admin unless the caller is one, and the refusal to remove the
	 * last Admin. Re-implementing the write here would have quietly dropped all
	 * three.
	 */
	async setUserRoles(
		input: SetPisoCampUserRolesInput & { actorId: string }
	): Promise<SetPisoCampUserRolesOutput> {
		const [account] = await db.select().from(users).where(eq(users.id, input.userId))
		if (!account) {
			throw new ORPCError("NOT_FOUND", { message: "Account not found" })
		}

		const known = new Set((await db.select({ name: roles.name }).from(roles)).map(r => r.name))
		const unknown = input.roles.filter(name => !known.has(name))
		if (unknown.length > 0) {
			// Named, not ignored: silently dropping a role would report success
			// for an assignment that never happened.
			throw new ORPCError("BAD_REQUEST", {
				message: `No such role: ${unknown.join(", ")}`,
			})
		}

		const current = new Set(await this.rolesOf(input.userId))
		const desired = new Set(input.roles)
		const assigned = [...desired].filter(name => !current.has(name)).sort()
		const revoked = [...current].filter(name => !desired.has(name)).sort()

		for (const roleName of assigned) {
			await this.rbacService.assignRole(input.userId, roleName, input.actorId)
		}
		for (const roleName of revoked) {
			await this.rbacService.removeRole(input.userId, roleName, input.actorId)
		}

		return {
			userId: input.userId,
			roles: (await this.rolesOf(input.userId)).sort(),
			assigned,
			revoked,
		}
	}

	private async rolesOf(userId: string): Promise<string[]> {
		const rows = await db
			.select({ name: roles.name })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(eq(userRoles.userId, userId))

		return rows.map(row => row.name)
	}
}
