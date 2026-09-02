import { describe, expect, it } from "vitest"

import {
	AttachPisoCampAssetInputSchema,
	DeletePisoCampAssetInputSchema,
	DetachPisoCampAssetInputSchema,
	ListPisoCampAssetsOutputSchema,
	PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES,
	PISO_CAMP_ASSET_MEDIA_TYPES,
	PISO_CAMP_ASSET_ROLES,
	PisoCampAssetMutationOutputSchema,
	PisoCampAssetRoleSchema,
	PisoCampAssetSchema,
	PisoCampVersionAssetSchema,
	UploadPisoCampAssetInputSchema,
} from "./asset.schema.js"

const assetId = "1596d8b6-c75c-43a4-9505-497f31f1ad80"
const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"
const requestId = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"
const currentVersionId = "fd21cf65-807b-4546-a7ed-e803d28568d2"
const asset = {
	id: assetId,
	contentItemId: itemId,
	sha256: "a".repeat(64),
	mediaType: "image/png",
	byteLength: 4,
	version: 1,
	createdAt: "2026-09-01T02:03:04.000Z",
} as const
const attachment = { role: "obverse", asset } as const

describe("CM-2 asset schemas", () => {
	it("freezes the exact role and canonical media-type catalogs", () => {
		expect(PISO_CAMP_ASSET_ROLES).toEqual([
			"obverse",
			"reverse",
			"edge",
			"texture",
			"audio",
			"animation",
		])
		expect(PISO_CAMP_ASSET_MEDIA_TYPES).toEqual([
			"image/png",
			"image/jpeg",
			"image/webp",
			"audio/mpeg",
			"audio/aac",
			"model/gltf-binary",
			"model/gltf+json",
			"model/vnd.usdz+zip",
		])
		expect(PisoCampAssetRoleSchema.safeParse("thumbnail").success).toBe(false)
	})

	it.each([
		["image/png", 10_485_760],
		["image/jpeg", 10_485_760],
		["image/webp", 10_485_760],
		["audio/mpeg", 26_214_400],
		["audio/aac", 26_214_400],
		["model/gltf-binary", 52_428_800],
		["model/gltf+json", 52_428_800],
		["model/vnd.usdz+zip", 52_428_800],
	] as const)("enforces the canonical %s metadata byte cap", (mediaType, maximumBytes) => {
		expect(
			PisoCampAssetSchema.safeParse({ ...asset, mediaType, byteLength: maximumBytes }).success
		).toBe(true)
		expect(
			PisoCampAssetSchema.safeParse({ ...asset, mediaType, byteLength: maximumBytes + 1 }).success
		).toBe(false)
		expect(PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES[mediaType]).toBe(maximumBytes)
	})

	it("accepts one bounded File and coerces only the multipart version scalar", () => {
		const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ignored.png", {
			type: "application/octet-stream",
		})
		const oversizedFile = new File([new Uint8Array([1])], "oversized.png")
		Object.defineProperty(oversizedFile, "size", { value: 52_428_801 })

		expect(
			UploadPisoCampAssetInputSchema.parse({
				file,
				itemId,
				expectedVersionNo: "7",
				role: "obverse",
				requestId,
			})
		).toMatchObject({ file, itemId, expectedVersionNo: 7, role: "obverse", requestId })
		expect(
			UploadPisoCampAssetInputSchema.safeParse({
				file: new File([], "empty.png"),
				itemId,
				expectedVersionNo: "7",
				role: "obverse",
				requestId,
			}).success
		).toBe(false)
		expect(
			UploadPisoCampAssetInputSchema.safeParse({
				file: oversizedFile,
				itemId,
				expectedVersionNo: "7",
				role: "obverse",
				requestId,
			}).success
		).toBe(false)
	})

	it("exposes strict safe metadata and rejects noncanonical values or private fields", () => {
		expect(PisoCampAssetSchema.parse(asset)).toEqual(asset)
		expect(PisoCampVersionAssetSchema.parse(attachment)).toEqual(attachment)

		for (const candidate of [
			{ ...asset, sha256: asset.sha256.toUpperCase() },
			{ ...asset, version: 0 },
			{ ...asset, createdAt: "2026-09-01T10:03:04.000+08:00" },
			{ ...asset, originalFilename: "private.png" },
			{ ...asset, path: "C:/private/upload.png" },
			{ ...asset, body: "raw bytes" },
		]) {
			expect(() => PisoCampAssetSchema.parse(candidate)).toThrow()
		}
		expect(() =>
			PisoCampVersionAssetSchema.parse({ ...attachment, originalFilename: "private.png" })
		).toThrow()
	})

	it("keeps attach, detach, and delete command bodies exact and strict", () => {
		const common = { assetId, itemId, expectedVersionNo: 7, requestId }

		expect(AttachPisoCampAssetInputSchema.parse({ ...common, role: "reverse" })).toEqual({
			...common,
			role: "reverse",
		})
		expect(DetachPisoCampAssetInputSchema.parse({ ...common, role: "reverse" })).toEqual({
			...common,
			role: "reverse",
		})
		expect(DeletePisoCampAssetInputSchema.parse(common)).toEqual(common)
		expect(
			AttachPisoCampAssetInputSchema.safeParse({ ...common, role: "reverse", unknown: true })
				.success
		).toBe(false)
		expect(
			DeletePisoCampAssetInputSchema.safeParse({ ...common, expectedVersionNo: "7" }).success
		).toBe(false)
	})

	it("returns exact current-version attachment and available-asset collections", () => {
		const mutation = {
			asset,
			currentVersionId,
			currentVersionNo: 8,
			attachments: [attachment],
		}
		const list = {
			currentVersionId,
			currentVersionNo: 8,
			attachments: [attachment],
			available: [asset],
		}

		expect(PisoCampAssetMutationOutputSchema.parse(mutation)).toEqual(mutation)
		expect(ListPisoCampAssetsOutputSchema.parse(list)).toEqual(list)
		expect(
			ListPisoCampAssetsOutputSchema.safeParse({ ...list, originalFilename: "private.png" }).success
		).toBe(false)
	})
})
