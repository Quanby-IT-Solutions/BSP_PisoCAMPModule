import { z } from "zod"

import { PisoCampContentStatusSchema, PisoCampContentTypeSchema } from "./content.schema.js"

/**
 * CM-4 restorable source states.
 *
 * Only a version BSP already approved may be restored. A draft or a submitted
 * version was never signed off, and restoring one would launder unreviewed
 * copy into an `approved` state without an approver ever seeing it.
 */
export const PISO_CAMP_RESTORABLE_STATUSES = ["approved", "published"] as const
export const PisoCampRestorableStatusSchema = z.enum(PISO_CAMP_RESTORABLE_STATUSES)

/**
 * Item states a restore may start from.
 *
 * `submitted_for_review` is excluded because a decision is pending on it — a
 * restore would silently replace the very version an approver is reading.
 * `archived` is excluded because BR-001 keeps it read-only.
 */
export const PISO_CAMP_RESTORE_SOURCE_ITEM_STATUSES = [
	"draft",
	"approved",
	"published",
	"unpublished",
	"deactivated",
] as const
export const PisoCampRestoreSourceItemStatusSchema = z.enum(PISO_CAMP_RESTORE_SOURCE_ITEM_STATUSES)

export const PISO_CAMP_CONTENT_DIFF_FIELDS = [
	"title",
	"summary",
	"body",
	"seriesCode",
	"denominationCode",
	"primaryUrl",
	"relatedLinks",
	"assets",
] as const
export const PisoCampContentDiffFieldSchema = z.enum(PISO_CAMP_CONTENT_DIFF_FIELDS)

const UtcTimestampSchema = z.iso
	.datetime()
	.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC")

const EditorIdentitySchema = z
	.object({ id: z.string().min(1).max(255), name: z.string().trim().min(1).max(200) })
	.strict()

const CommentsSchema = z.string().trim().min(1).max(2_000)

/** One field that differs between a historical version and the current one. */
export const PisoCampContentDifferenceSchema = z
	.object({
		field: PisoCampContentDiffFieldSchema,
		/** The historical version's value, rendered as comparable text. */
		previous: z.string().max(20_000).nullable(),
		/** The current working version's value, rendered the same way. */
		current: z.string().max(20_000).nullable(),
	})
	.strict()
	.refine(difference => difference.previous !== difference.current, {
		message: "A difference must actually differ",
	})

export const PisoCampContentVersionHistoryEntrySchema = z
	.object({
		id: z.uuid(),
		versionNo: z.number().int().positive(),
		status: PisoCampContentStatusSchema,
		contentType: PisoCampContentTypeSchema,
		title: z.string().trim().min(1).max(160),
		createdBy: EditorIdentitySchema,
		createdAt: UtcTimestampSchema,
		approver: EditorIdentitySchema.nullable(),
		approvedAt: UtcTimestampSchema.nullable(),
		publisher: EditorIdentitySchema.nullable(),
		publishedAt: UtcTimestampSchema.nullable(),
		transitionAction: z.enum(["submit", "approve", "reject", "publish"]).nullable(),
		transitionComments: CommentsSchema.nullable(),
		restoredFromVersionNo: z.number().int().positive().nullable(),
		isCurrentWorking: z.boolean(),
		isCurrentPublished: z.boolean(),
		/** True when this exact version may be restored right now. */
		restorable: z.boolean(),
		differences: z.array(PisoCampContentDifferenceSchema).max(8),
	})
	.strict()
	.superRefine((entry, context) => {
		if ((entry.approver === null) !== (entry.approvedAt === null)) {
			context.addIssue({
				code: "custom",
				message: "Approver and approval time must be present together",
				path: ["approver"],
			})
		}
		if ((entry.publisher === null) !== (entry.publishedAt === null)) {
			context.addIssue({
				code: "custom",
				message: "Publisher and publication time must be present together",
				path: ["publisher"],
			})
		}
		if (entry.isCurrentWorking && entry.differences.length > 0) {
			context.addIssue({
				code: "custom",
				message: "The current version cannot differ from itself",
				path: ["differences"],
			})
		}
		if (entry.restorable && entry.isCurrentWorking) {
			context.addIssue({
				code: "custom",
				message: "The current working version is not a restore source",
				path: ["restorable"],
			})
		}
	})

export const ListPisoCampContentVersionsInputSchema = z
	.object({
		itemId: z.uuid(),
		page: z.coerce.number().int().positive().default(1),
		limit: z.coerce.number().int().min(1).max(50).default(20),
	})
	.strict()

export const ListPisoCampContentVersionsOutputSchema = z
	.object({
		itemId: z.uuid(),
		itemStatus: PisoCampContentStatusSchema,
		currentVersionNo: z.number().int().positive(),
		restoreAvailable: z.boolean(),
		versions: z.array(PisoCampContentVersionHistoryEntrySchema),
		page: z.number().int().positive(),
		limit: z.number().int().positive(),
		total: z.number().int().nonnegative(),
	})
	.strict()

export const RestorePisoCampContentVersionInputSchema = z
	.object({
		itemId: z.uuid(),
		versionNo: z.coerce.number().int().positive(),
		requestId: z.uuid(),
		expectedVersionNo: z.number().int().positive(),
		// Required, exactly as approval comments are: a restore approves content
		// without a fresh review, so the reason has to be on the record.
		comments: CommentsSchema,
	})
	.strict()
	.refine(input => input.versionNo !== input.expectedVersionNo, {
		message: "A version cannot be restored onto itself",
		path: ["versionNo"],
	})

export type PisoCampRestorableStatus = z.infer<typeof PisoCampRestorableStatusSchema>
export type PisoCampContentDiffField = z.infer<typeof PisoCampContentDiffFieldSchema>
export type PisoCampContentDifference = z.infer<typeof PisoCampContentDifferenceSchema>
export type PisoCampContentVersionHistoryEntry = z.infer<
	typeof PisoCampContentVersionHistoryEntrySchema
>
export type ListPisoCampContentVersionsInput = z.infer<
	typeof ListPisoCampContentVersionsInputSchema
>
export type ListPisoCampContentVersionsOutput = z.infer<
	typeof ListPisoCampContentVersionsOutputSchema
>
export type RestorePisoCampContentVersionInput = z.infer<
	typeof RestorePisoCampContentVersionInputSchema
>
