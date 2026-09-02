import { describe, expect, it } from "vitest"
import type { z } from "zod"

import { v1Contract } from "../v1.contract.js"
import { pisoCampAssetContract } from "./asset.contract.js"

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

function parse(schema: unknown, value: unknown): unknown {
	return (schema as z.ZodType).parse(value)
}

describe("CM-2 asset contract", () => {
	it.each([
		["list", "GET", "/admin/pisocamp/content/{itemId}/assets"],
		["upload", "POST", "/admin/pisocamp/assets"],
		["attach", "POST", "/admin/pisocamp/assets/{assetId}/attach"],
		["detach", "POST", "/admin/pisocamp/assets/{assetId}/detach"],
		["delete", "DELETE", "/admin/pisocamp/assets/{assetId}"],
	] as const)("registers %s with exact protected route metadata", (procedure, method, path) => {
		const route = pisoCampAssetContract[procedure]["~orpc"].route

		expect(route).toMatchObject({
			method,
			path,
			tags: ["Piso CAMP Content Assets"],
		})
		expect(route.spec).toBeUndefined()
	})

	it.each([
		["list", "GET", "/v1/admin/pisocamp/content/{itemId}/assets"],
		["upload", "POST", "/v1/admin/pisocamp/assets"],
		["attach", "POST", "/v1/admin/pisocamp/assets/{assetId}/attach"],
		["detach", "POST", "/v1/admin/pisocamp/assets/{assetId}/detach"],
		["delete", "DELETE", "/v1/admin/pisocamp/assets/{assetId}"],
	] as const)("composes %s once under v1.pisocamp.admin.assets", (procedure, method, path) => {
		expect(v1Contract.pisocamp.admin.assets[procedure]["~orpc"].route).toMatchObject({
			method,
			path,
		})
	})

	it("binds strict list and mutation input schemas to the exact procedures", () => {
		const common = { assetId, itemId, expectedVersionNo: 7, requestId }
		const file = new File([new Uint8Array([1])], "ignored.bin")

		expect(parse(pisoCampAssetContract.list["~orpc"].inputSchema, { itemId })).toEqual({ itemId })
		expect(
			parse(pisoCampAssetContract.upload["~orpc"].inputSchema, {
				file,
				itemId,
				expectedVersionNo: "7",
				role: "obverse",
				requestId,
			})
		).toMatchObject({ file, itemId, expectedVersionNo: 7, role: "obverse", requestId })
		expect(
			parse(pisoCampAssetContract.attach["~orpc"].inputSchema, { ...common, role: "audio" })
		).toEqual({ ...common, role: "audio" })
		expect(
			parse(pisoCampAssetContract.detach["~orpc"].inputSchema, { ...common, role: "audio" })
		).toEqual({ ...common, role: "audio" })
		expect(parse(pisoCampAssetContract.delete["~orpc"].inputSchema, common)).toEqual(common)
	})

	it("binds the exact list and mutation output shapes to every procedure", () => {
		const attachments = [{ role: "obverse", asset }] as const
		const mutationOutput = {
			asset,
			currentVersionId,
			currentVersionNo: 8,
			attachments,
		}
		const listOutput = {
			currentVersionId,
			currentVersionNo: 8,
			attachments,
			available: [asset],
		}

		expect(parse(pisoCampAssetContract.list["~orpc"].outputSchema, listOutput)).toEqual(listOutput)
		for (const procedure of ["upload", "attach", "detach", "delete"] as const) {
			expect(parse(pisoCampAssetContract[procedure]["~orpc"].outputSchema, mutationOutput)).toEqual(
				mutationOutput
			)
		}
	})
})
