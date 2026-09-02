import { z } from "zod"

export const PISO_CAMP_ASSET_ROLES = [
	"obverse",
	"reverse",
	"edge",
	"texture",
	"audio",
	"animation",
] as const

export const PISO_CAMP_ASSET_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"audio/mpeg",
	"audio/aac",
	"model/gltf-binary",
	"model/gltf+json",
	"model/vnd.usdz+zip",
] as const

export const PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES = {
	"image/png": 10_485_760,
	"image/jpeg": 10_485_760,
	"image/webp": 10_485_760,
	"audio/mpeg": 26_214_400,
	"audio/aac": 26_214_400,
	"model/gltf-binary": 52_428_800,
	"model/gltf+json": 52_428_800,
	"model/vnd.usdz+zip": 52_428_800,
} as const satisfies Record<(typeof PISO_CAMP_ASSET_MEDIA_TYPES)[number], number>

export const PisoCampAssetRoleSchema = z.enum(PISO_CAMP_ASSET_ROLES)
export const PisoCampAssetMediaTypeSchema = z.enum(PISO_CAMP_ASSET_MEDIA_TYPES)

const UtcTimestampSchema = z.iso
	.datetime()
	.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC")
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const PisoCampAssetSchema = z
	.object({
		id: z.uuid(),
		contentItemId: z.uuid(),
		sha256: Sha256Schema,
		mediaType: PisoCampAssetMediaTypeSchema,
		byteLength: z.number().int().min(1).max(52_428_800),
		version: z.number().int().positive(),
		createdAt: UtcTimestampSchema,
	})
	.strict()
	.superRefine((asset, context) => {
		const maximumBytes = PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES[asset.mediaType]
		if (asset.byteLength > maximumBytes) {
			context.addIssue({
				code: "custom",
				message: `${asset.mediaType} assets cannot exceed ${maximumBytes} bytes`,
				path: ["byteLength"],
			})
		}
	})

export const PisoCampVersionAssetSchema = z
	.object({
		role: PisoCampAssetRoleSchema,
		asset: PisoCampAssetSchema,
	})
	.strict()

export const ListPisoCampAssetsOutputSchema = z
	.object({
		currentVersionId: z.uuid(),
		currentVersionNo: z.number().int().positive(),
		attachments: z.array(PisoCampVersionAssetSchema),
		available: z.array(PisoCampAssetSchema),
	})
	.strict()

export const UploadPisoCampAssetInputSchema = z
	.object({
		file: z.file().min(1).max(52_428_800),
		itemId: z.uuid(),
		expectedVersionNo: z.coerce.number().int().positive(),
		role: PisoCampAssetRoleSchema,
		requestId: z.uuid(),
	})
	.strict()

const AssetMutationCorrelationShape = {
	assetId: z.uuid(),
	itemId: z.uuid(),
	expectedVersionNo: z.number().int().positive(),
	requestId: z.uuid(),
}

export const AttachPisoCampAssetInputSchema = z
	.object({ ...AssetMutationCorrelationShape, role: PisoCampAssetRoleSchema })
	.strict()

export const DetachPisoCampAssetInputSchema = z
	.object({ ...AssetMutationCorrelationShape, role: PisoCampAssetRoleSchema })
	.strict()

export const DeletePisoCampAssetInputSchema = z.object(AssetMutationCorrelationShape).strict()

export const PisoCampAssetMutationOutputSchema = z
	.object({
		asset: PisoCampAssetSchema,
		currentVersionId: z.uuid(),
		currentVersionNo: z.number().int().positive(),
		attachments: z.array(PisoCampVersionAssetSchema),
	})
	.strict()

export const UploadPisoCampAssetOutputSchema = PisoCampAssetMutationOutputSchema
export const AttachPisoCampAssetOutputSchema = PisoCampAssetMutationOutputSchema
export const DetachPisoCampAssetOutputSchema = PisoCampAssetMutationOutputSchema
export const DeletePisoCampAssetOutputSchema = PisoCampAssetMutationOutputSchema

export type PisoCampAssetRole = z.infer<typeof PisoCampAssetRoleSchema>
export type PisoCampAssetMediaType = z.infer<typeof PisoCampAssetMediaTypeSchema>
export type PisoCampAsset = z.infer<typeof PisoCampAssetSchema>
export type PisoCampVersionAsset = z.infer<typeof PisoCampVersionAssetSchema>
export type ListPisoCampAssetsOutput = z.infer<typeof ListPisoCampAssetsOutputSchema>
export type UploadPisoCampAssetInput = z.infer<typeof UploadPisoCampAssetInputSchema>
export type AttachPisoCampAssetInput = z.infer<typeof AttachPisoCampAssetInputSchema>
export type DetachPisoCampAssetInput = z.infer<typeof DetachPisoCampAssetInputSchema>
export type DeletePisoCampAssetInput = z.infer<typeof DeletePisoCampAssetInputSchema>
export type PisoCampAssetMutationOutput = z.infer<typeof PisoCampAssetMutationOutputSchema>
export type UploadPisoCampAssetOutput = z.infer<typeof UploadPisoCampAssetOutputSchema>
export type AttachPisoCampAssetOutput = z.infer<typeof AttachPisoCampAssetOutputSchema>
export type DetachPisoCampAssetOutput = z.infer<typeof DetachPisoCampAssetOutputSchema>
export type DeletePisoCampAssetOutput = z.infer<typeof DeletePisoCampAssetOutputSchema>
