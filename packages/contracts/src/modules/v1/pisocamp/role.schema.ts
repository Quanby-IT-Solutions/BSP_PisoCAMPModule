import { z } from "zod"

import { PermissionNameSchema } from "../rbac/rbac.catalog.js"

/**
 * One role and the permission keys it carries.
 *
 * The keys are read-only here: editing a role's bundle is a later change
 * request, and showing them is what makes least privilege checkable — an
 * assignment nobody can see the consequences of is not one anybody can review.
 */
export const PisoCampRoleSchema = z
	.object({
		name: z.string().min(1).max(120),
		description: z.string().nullable(),
		permissions: z.array(PermissionNameSchema),
		/** How many accounts currently hold it. */
		userCount: z.number().int().nonnegative(),
	})
	.strict()

export const ListPisoCampRolesOutputSchema = z
	.object({ roles: z.array(PisoCampRoleSchema) })
	.strict()

/**
 * The complete set of roles an account should end up with.
 *
 * A set rather than one grant or revoke at a time: an administrator decides
 * what somebody should hold, and sending the whole answer means the server
 * works out the difference instead of the screen having to.
 */
export const SetPisoCampUserRolesInputSchema = z
	.object({
		userId: z.string().min(1),
		roles: z.array(z.string().min(1).max(120)).max(50),
	})
	.strict()

export const SetPisoCampUserRolesOutputSchema = z
	.object({
		userId: z.string().min(1),
		roles: z.array(z.string()),
		/** What actually changed, so the screen can say so rather than guess. */
		assigned: z.array(z.string()),
		revoked: z.array(z.string()),
	})
	.strict()

export type PisoCampRole = z.infer<typeof PisoCampRoleSchema>
export type ListPisoCampRolesOutput = z.infer<typeof ListPisoCampRolesOutputSchema>
export type SetPisoCampUserRolesInput = z.infer<typeof SetPisoCampUserRolesInputSchema>
export type SetPisoCampUserRolesOutput = z.infer<typeof SetPisoCampUserRolesOutputSchema>
