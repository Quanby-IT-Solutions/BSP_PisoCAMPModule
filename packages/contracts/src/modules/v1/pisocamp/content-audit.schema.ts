import { z } from "zod"

import { PisoCampContentStatusSchema } from "./content.schema.js"

/**
 * CM-7 auditable actions on one content item.
 *
 * A closed list rather than free text: the filter is a dropdown, and an action
 * that is not in this list is one nobody has taught the audit view to explain.
 */
export const PISO_CAMP_CONTENT_AUDIT_ACTIONS = [
	"content.create",
	"content.edit",
	"content.submit",
	"content.approve",
	"content.reject",
	"content.publish",
	"content.unpublish",
	"content.deactivate",
	"content.archive",
	"content.schedule",
	"content.restore",
	"content.preview",
	"content.asset.upload",
	"content.asset.attach",
	"content.asset.detach",
	"content.asset.delete",
] as const
export const PisoCampContentAuditActionSchema = z.enum(PISO_CAMP_CONTENT_AUDIT_ACTIONS)

const UtcTimestampSchema = z.iso
	.datetime()
	.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC")

const ActorSchema = z
	.object({ id: z.string().min(1).max(255), name: z.string().trim().min(1).max(200) })
	.strict()

export const PisoCampContentAuditEntrySchema = z
	.object({
		id: z.number().int().positive(),
		action: PisoCampContentAuditActionSchema,
		/** Present for a workflow transition; null for an edit or an asset action. */
		fromState: PisoCampContentStatusSchema.nullable(),
		toState: PisoCampContentStatusSchema.nullable(),
		versionNo: z.number().int().positive().nullable(),
		comments: z.string().min(1).max(2_000).nullable(),
		/** Null when the account that acted has since been removed. */
		actor: ActorSchema.nullable(),
		at: UtcTimestampSchema,
	})
	.strict()

export const ListPisoCampContentAuditInputSchema = z
	.object({
		itemId: z.uuid(),
		page: z.coerce.number().int().positive().default(1),
		limit: z.coerce.number().int().min(1).max(100).default(25),
		actorId: z.string().min(1).max(255).optional(),
		action: PisoCampContentAuditActionSchema.optional(),
		/** Inclusive lower bound. */
		from: UtcTimestampSchema.optional(),
		/** Inclusive upper bound. */
		to: UtcTimestampSchema.optional(),
	})
	.strict()
	.refine(input => !input.from || !input.to || input.from <= input.to, {
		message: "The date range must start before it ends",
		path: ["to"],
	})

export const ListPisoCampContentAuditOutputSchema = z
	.object({
		itemId: z.uuid(),
		entries: z.array(PisoCampContentAuditEntrySchema),
		/** Every actor that appears in this item's history, for the filter. */
		actors: z.array(ActorSchema).max(200),
		page: z.number().int().positive(),
		limit: z.number().int().positive(),
		total: z.number().int().nonnegative(),
	})
	.strict()

export type PisoCampContentAuditAction = z.infer<typeof PisoCampContentAuditActionSchema>
export type PisoCampContentAuditEntry = z.infer<typeof PisoCampContentAuditEntrySchema>
export type ListPisoCampContentAuditInput = z.infer<typeof ListPisoCampContentAuditInputSchema>
export type ListPisoCampContentAuditOutput = z.infer<typeof ListPisoCampContentAuditOutputSchema>
