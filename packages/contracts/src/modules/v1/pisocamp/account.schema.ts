import { z } from "zod"

/**
 * Whether an account may authenticate.
 *
 * Deactivation is not deletion: the row, its history and everything it produced
 * stay exactly where they are (SA-7 owns deletion). Only the ability to sign in
 * and to reach registered-only functions is withdrawn.
 */
export const ACCOUNT_STATUSES = ["active", "deactivated"] as const
export const AccountStatusSchema = z.enum(ACCOUNT_STATUSES)
export type AccountStatus = z.infer<typeof AccountStatusSchema>

export const PisoCampAccountSchema = z
	.object({
		id: z.string().min(1),
		name: z.string(),
		email: z.email(),
		status: AccountStatusSchema,
		/** Why access was withdrawn. Null for an account that has never been. */
		reason: z.string().min(1).max(500).nullable(),
		/** When the status last moved. Null while it has never moved. */
		statusChangedAt: z.iso.datetime({ offset: true }).nullable(),
		roles: z.array(z.string()),
	})
	.strict()

export const ListPisoCampAccountsInputSchema = z
	.object({
		/** Matches a name or an email address, case-insensitively. */
		search: z.string().max(200).optional(),
		status: AccountStatusSchema.optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
	})
	.strict()

export const ListPisoCampAccountsOutputSchema = z
	.object({
		accounts: z.array(PisoCampAccountSchema),
		total: z.number().int().nonnegative(),
		page: z.number().int().min(1),
		limit: z.number().int().min(1).max(100),
	})
	.strict()

/**
 * A status change, with the reason it needs.
 *
 * Deactivating demands a reason and reactivating refuses one: "why was this
 * person locked out" must always have an answer, and a reason attached to
 * restoring access would only ever be misread as one for removing it.
 */
export const SetPisoCampAccountStatusInputSchema = z
	.discriminatedUnion("status", [
		z
			.object({
				accountId: z.string().min(1),
				status: z.literal("deactivated"),
				reason: z.string().min(1).max(500),
			})
			.strict(),
		z
			.object({
				accountId: z.string().min(1),
				status: z.literal("active"),
			})
			.strict(),
	])

export type PisoCampAccount = z.infer<typeof PisoCampAccountSchema>
export type ListPisoCampAccountsInput = z.infer<typeof ListPisoCampAccountsInputSchema>
export type ListPisoCampAccountsOutput = z.infer<typeof ListPisoCampAccountsOutputSchema>
export type SetPisoCampAccountStatusInput = z.infer<typeof SetPisoCampAccountStatusInputSchema>
