import { describe, expect, it } from "vitest"
import type { z } from "zod"

import { v1Contract } from "../v1.contract.js"
import { pisoCampContentPreviewContract, pisoCampPreviewContract } from "./preview.contract.js"
import type { PisoCampContentPreview, PisoCampContentPreviewGrant } from "./preview.schema.js"

const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"
const versionId = "fd21cf65-807b-4546-a7ed-e803d28568d2"
const assetId = "1596d8b6-c75c-43a4-9505-497f31f1ad80"
const token = "v1.eyJhIjoxfQ.c2lnbmF0dXJl"

const preview: PisoCampContentPreview = {
	itemId,
	versionId,
	versionNo: 3,
	status: "approved",
	contentType: "coin",
	content: {
		contentType: "coin",
		title: "NGC 20 Piso",
		summary: "Bi-metallic circulating coin.",
		body: "Obverse carries the portrait; reverse carries the Malacañang Palace.",
		seriesCode: "ngc-coins",
		denominationCode: "ngc-20-piso",
	},
	relatedLinks: [
		{
			id: "3f2a1a44-1f2b-4d3c-9d1e-2b7a5c8e1f10",
			position: 0,
			kind: "external",
			label: "BSP coin page",
			url: "https://www.bsp.gov.ph/coins",
		},
	],
	assets: [
		{
			role: "obverse",
			assetId,
			mediaType: "image/png",
			byteLength: 4,
			sha256: "a".repeat(64),
		},
	],
	generatedAt: "2026-09-02T01:02:03.000Z",
}

const grant: PisoCampContentPreviewGrant = {
	preview,
	token,
	expiresAt: "2026-09-02T01:07:03.000Z",
}

function parse(schema: unknown, value: unknown): unknown {
	return (schema as z.ZodType).parse(value)
}

function reject(schema: unknown, value: unknown): void {
	expect(() => (schema as z.ZodType).parse(value)).toThrow()
}

describe("CM-5 preview contract", () => {
	it("registers the admin grant route behind the session-protected spec", () => {
		const route = pisoCampContentPreviewContract.create["~orpc"].route

		expect(route).toMatchObject({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/versions/{versionNo}/preview",
			tags: ["Piso CAMP Content Preview"],
		})
		expect(route.spec).toBeUndefined()
	})

	it("registers the redemption route as explicitly token-authenticated", () => {
		const route = pisoCampPreviewContract.redeem["~orpc"].route

		expect(route).toMatchObject({
			method: "GET",
			path: "/pisocamp/preview",
			tags: ["Piso CAMP Content Preview"],
		})
		const spec = route.spec
		expect(typeof spec).toBe("function")
		expect((spec as (current: object) => object)({})).toEqual({ security: [] })
	})

	it("composes both procedures once under the v1 router", () => {
		expect(v1Contract.pisocamp.admin.preview.create["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/v1/admin/pisocamp/content/{itemId}/versions/{versionNo}/preview",
		})
		expect(v1Contract.pisocamp.preview.redeem["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/v1/pisocamp/preview",
		})
	})

	it("coerces the path version number and rejects non-positive versions", () => {
		const schema = pisoCampContentPreviewContract.create["~orpc"].inputSchema

		expect(parse(schema, { itemId, versionNo: "3" })).toEqual({ itemId, versionNo: 3 })
		reject(schema, { itemId, versionNo: "0" })
		reject(schema, { itemId, versionNo: "1.5" })
		reject(schema, { itemId, versionNo: 3, extra: true })
	})

	it("accepts only well-formed opaque tokens on redemption", () => {
		const schema = pisoCampPreviewContract.redeem["~orpc"].inputSchema

		expect(parse(schema, { token })).toEqual({ token })
		reject(schema, { token: "v1.only-two-parts" })
		reject(schema, { token: "v2.eyJhIjoxfQ.c2ln" })
		reject(schema, { token: "v1.not+base64url.c2ln" })
		reject(schema, { token: `v1.${"a".repeat(2_000)}.c2ln` })
	})

	it("binds the grant and preview output shapes to the exact procedures", () => {
		expect(parse(pisoCampContentPreviewContract.create["~orpc"].outputSchema, grant)).toEqual(grant)
		expect(parse(pisoCampPreviewContract.redeem["~orpc"].outputSchema, preview)).toEqual(preview)
	})

	it("refuses to describe a published version or a mismatched content type", () => {
		const schema = pisoCampPreviewContract.redeem["~orpc"].outputSchema

		reject(schema, { ...preview, status: "published" })
		reject(schema, { ...preview, contentType: "banknote" })
	})
})
