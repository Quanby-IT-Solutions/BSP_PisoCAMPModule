import { createHash, createPublicKey, verify } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
	PisoCampBundleEnvelopeSchema,
	PisoCampBundleManifestEntrySchema,
	PisoCampBundleManifestSchema,
} from "./bundle.schema.js"
import vector from "./fixtures/ce1-ed25519-vector.json"

const digest = "a".repeat(64)
const resourcePath = `/pisocamp/bundle/resources/${digest}`

function entry(overrides: Record<string, unknown> = {}) {
	return {
		logicalId: "currency.ngc.php-20",
		kind: "content",
		delivery: "core",
		mediaType: "application/json",
		byteLength: 64,
		sha256: digest,
		downloadPath: resourcePath,
		contentItemId: "11111111-1111-4111-8111-111111111111",
		contentVersionId: "22222222-2222-4222-8222-222222222222",
		...overrides,
	}
}

function manifest(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		bundleVersion: "1",
		generatedAt: "2026-08-27T00:00:00.000Z",
		minimumClientSchemaVersion: 1,
		entries: [entry()],
		...overrides,
	}
}

function envelope(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		algorithm: "Ed25519",
		keyId: vector.keyId,
		payload: vector.payloadBase64url,
		signature: vector.signatureBase64url,
		...overrides,
	}
}

describe("CE-1 strict bundle schemas", () => {
	it("parses the fixed test-only signed vector and its decoded strict manifest", () => {
		const payload = Buffer.from(vector.payloadBase64url, "base64url")

		expect(PisoCampBundleEnvelopeSchema.parse(envelope())).toEqual(envelope())
		expect(PisoCampBundleManifestSchema.parse(JSON.parse(vector.manifestJson))).toEqual(
			JSON.parse(vector.manifestJson)
		)
		expect(payload.toString("hex")).toBe(vector.payloadUtf8Hex)
		expect(payload.toString("utf8")).toBe(vector.manifestJson)
		expect(createHash("sha256").update(payload).digest("hex")).toBe(vector.sha256)
		expect(
			verify(
				null,
				payload,
				createPublicKey(vector.publicKeySpkiPem),
				Buffer.from(vector.signatureBase64url, "base64url")
			)
		).toBe(true)
	})

	it("rejects unknown fields at every strict envelope and manifest boundary", () => {
		expect(PisoCampBundleEnvelopeSchema.safeParse({ ...envelope(), extra: true }).success).toBe(
			false
		)
		expect(PisoCampBundleManifestSchema.safeParse({ ...manifest(), extra: true }).success).toBe(
			false
		)
		expect(PisoCampBundleManifestEntrySchema.safeParse({ ...entry(), extra: true }).success).toBe(
			false
		)
	})

	it("rejects unsupported envelope algorithms and malformed or padded base64url", () => {
		for (const value of [
			{ ...envelope(), algorithm: "ES256" },
			{ ...envelope(), payload: `${vector.payloadBase64url}=` },
			{ ...envelope(), payload: "not+base64" },
			{ ...envelope(), payload: "a" },
		]) {
			expect(PisoCampBundleEnvelopeSchema.safeParse(value).success).toBe(false)
		}

		for (const payload of ["AA", "AAA"]) {
			expect(PisoCampBundleEnvelopeSchema.safeParse({ ...envelope(), payload }).success).toBe(true)
		}

		for (const payload of ["AB", "AAB"]) {
			expect(PisoCampBundleEnvelopeSchema.safeParse({ ...envelope(), payload }).success).toBe(false)
		}
	})

	it("rejects noncanonical versions and non-UTC timestamps", () => {
		for (const value of [
			manifest({ bundleVersion: "01" }),
			manifest({ bundleVersion: "-1" }),
			manifest({ generatedAt: "2026-08-27T08:00:00.000+08:00" }),
		]) {
			expect(PisoCampBundleManifestSchema.safeParse(value).success).toBe(false)
		}
	})

	it("rejects unsorted or duplicate logical IDs", () => {
		const later = entry({ logicalId: "currency.ngc.php-50", sha256: "b".repeat(64) })
		expect(
			PisoCampBundleManifestSchema.safeParse(manifest({ entries: [later, entry()] })).success
		).toBe(false)
		expect(
			PisoCampBundleManifestSchema.safeParse(
				manifest({ entries: [entry(), entry({ sha256: "b".repeat(64) })] })
			).success
		).toBe(false)
	})

	it("rejects mismatched ownership pairs and unsafe resource paths", () => {
		for (const value of [
			entry({ contentVersionId: undefined }),
			entry({ downloadPath: "/pisocamp/bundle/resources/not-the-digest" }),
			entry({ downloadPath: `/pisocamp/bundle/resources/${digest.toUpperCase()}` }),
		]) {
			expect(PisoCampBundleManifestEntrySchema.safeParse(value).success).toBe(false)
		}
	})

	it.each([
		["kind", "document"],
		["delivery", "background"],
		["mediaType", "image/svg+xml"],
	] as const)("rejects unsupported entry %s values", (field, value) => {
		expect(PisoCampBundleManifestEntrySchema.safeParse(entry({ [field]: value })).success).toBe(
			false
		)
	})

	it("enforces entry count, core entry bytes, aggregate core bytes, payload bytes, and signature bytes", () => {
		expect(
			PisoCampBundleManifestSchema.safeParse(
				manifest({
					entries: Array.from({ length: 2_001 }, (_, index) => entry({ logicalId: `x.${index}` })),
				})
			).success
		).toBe(false)
		expect(
			PisoCampBundleManifestEntrySchema.safeParse(entry({ byteLength: 5_242_881 })).success
		).toBe(false)
		expect(
			PisoCampBundleManifestSchema.safeParse(
				manifest({
					entries: Array.from({ length: 11 }, (_, index) =>
						entry({
							logicalId: `core.${String(index).padStart(2, "0")}`,
							byteLength: 5_242_880,
						})
					),
				})
			).success
		).toBe(false)
		expect(
			PisoCampBundleEnvelopeSchema.safeParse({
				...envelope(),
				payload: Buffer.alloc(2_097_153).toString("base64url"),
			}).success
		).toBe(false)
		expect(
			PisoCampBundleEnvelopeSchema.safeParse({
				...envelope(),
				signature: Buffer.alloc(63).toString("base64url"),
			}).success
		).toBe(false)
	})
})

describe("manifest entry kinds", () => {
	it("accepts a binary glTF model entry", () => {
		const parsed = PisoCampBundleManifestEntrySchema.safeParse(
			entry({
				logicalId: "model.seed.coin-education",
				kind: "model",
				mediaType: "model/gltf-binary",
				contentItemId: undefined,
				contentVersionId: undefined,
			})
		)

		expect(parsed.success).toBe(true)
	})

	it.each([
		["a model claiming JSON", { kind: "model", mediaType: "application/json" }],
		["a model claiming PNG", { kind: "model", mediaType: "image/png" }],
		["content claiming glTF", { kind: "content", mediaType: "model/gltf-binary" }],
		["an image claiming glTF", { kind: "image", mediaType: "model/gltf-binary" }],
		["an image claiming JSON", { kind: "image", mediaType: "application/json" }],
	])("refuses %s", (_label, overrides) => {
		const parsed = PisoCampBundleManifestEntrySchema.safeParse(entry(overrides))

		expect(parsed.success).toBe(false)
		expect(parsed.error?.issues.some(issue => issue.path.includes("mediaType"))).toBe(true)
	})

	it("refuses a kind no client knows how to render", () => {
		expect(PisoCampBundleManifestEntrySchema.safeParse(entry({ kind: "video" })).success).toBe(
			false
		)
	})

	it("holds a model to the same core size limit as anything else", () => {
		const parsed = PisoCampBundleManifestEntrySchema.safeParse(
			entry({
				kind: "model",
				mediaType: "model/gltf-binary",
				delivery: "core",
				byteLength: 5_242_881,
				contentItemId: undefined,
				contentVersionId: undefined,
			})
		)

		expect(parsed.success).toBe(false)
	})
})
