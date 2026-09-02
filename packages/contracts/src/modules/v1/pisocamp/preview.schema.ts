import { z } from "zod"

import { PisoCampAssetMediaTypeSchema, PisoCampAssetRoleSchema } from "./asset.schema.js"
import {
	PisoCampContentDraftSchema,
	PisoCampContentTypeSchema,
	PisoCampRelatedLinkOutputSchema,
} from "./content.schema.js"

/**
 * CM-5 previewable version states.
 *
 * Preview exists to catch errors *before* publication, so it is scoped to the
 * pre-publication states only. A `published` version is already live and a
 * `deactivated`/`archived` one is deliberately withdrawn; rendering either
 * through the preview path would blur the line the workflow draws.
 */
export const PISO_CAMP_PREVIEWABLE_STATUSES = ["draft", "submitted_for_review", "approved"] as const

export const PisoCampPreviewableStatusSchema = z.enum(PISO_CAMP_PREVIEWABLE_STATUSES)

const UtcTimestampSchema = z.iso
	.datetime()
	.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC")

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

/**
 * Opaque, signed, short-lived preview grant.
 *
 * Three dot-separated base64url segments (`version.payload.signature`). The
 * shape is validated here so a malformed value is rejected at the contract
 * boundary rather than inside the verifier, and so the token can travel in a
 * query string (the admin console's `<img>`/`<audio>` elements and the mobile
 * preview build both need it there — neither can attach a session cookie to a
 * media subresource on the API origin).
 */
export const PisoCampContentPreviewTokenSchema = z
	.string()
	.min(1)
	.max(1_024)
	.regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "Malformed preview token")

/**
 * One attachment carried by the previewed version.
 *
 * Deliberately no URL: the caller composes
 * `/v1/pisocamp/preview/resources/{assetId}?token={token}` from the grant it
 * already holds. Embedding the token per asset would duplicate a credential
 * across the payload and invite it into logs and caches.
 */
export const PisoCampContentPreviewAssetSchema = z
	.object({
		role: PisoCampAssetRoleSchema,
		assetId: z.uuid(),
		mediaType: PisoCampAssetMediaTypeSchema,
		byteLength: z.number().int().min(1).max(52_428_800),
		sha256: Sha256Schema,
	})
	.strict()

export const PisoCampContentPreviewSchema = z
	.object({
		itemId: z.uuid(),
		versionId: z.uuid(),
		versionNo: z.number().int().positive(),
		status: PisoCampPreviewableStatusSchema,
		contentType: PisoCampContentTypeSchema,
		content: PisoCampContentDraftSchema,
		relatedLinks: z.array(PisoCampRelatedLinkOutputSchema).max(10),
		assets: z.array(PisoCampContentPreviewAssetSchema).max(6),
		generatedAt: UtcTimestampSchema,
	})
	.strict()
	.superRefine((preview, context) => {
		if (preview.contentType !== preview.content.contentType) {
			context.addIssue({
				code: "custom",
				message: "Preview and version content types must match",
				path: ["content", "contentType"],
			})
		}
	})

export const PisoCampContentPreviewGrantSchema = z
	.object({
		preview: PisoCampContentPreviewSchema,
		token: PisoCampContentPreviewTokenSchema,
		expiresAt: UtcTimestampSchema,
	})
	.strict()

export const GetPisoCampContentPreviewInputSchema = z
	.object({
		itemId: z.uuid(),
		versionNo: z.coerce.number().int().positive(),
	})
	.strict()

export const RedeemPisoCampContentPreviewInputSchema = z
	.object({ token: PisoCampContentPreviewTokenSchema })
	.strict()

export type PisoCampPreviewableStatus = z.infer<typeof PisoCampPreviewableStatusSchema>
export type PisoCampContentPreviewAsset = z.infer<typeof PisoCampContentPreviewAssetSchema>
export type PisoCampContentPreview = z.infer<typeof PisoCampContentPreviewSchema>
export type PisoCampContentPreviewGrant = z.infer<typeof PisoCampContentPreviewGrantSchema>
export type GetPisoCampContentPreviewInput = z.infer<typeof GetPisoCampContentPreviewInputSchema>
export type RedeemPisoCampContentPreviewInput = z.infer<
	typeof RedeemPisoCampContentPreviewInputSchema
>
