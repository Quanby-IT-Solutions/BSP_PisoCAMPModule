import { z } from "zod"

const MAX_MANIFEST_ENTRIES = 2_000
const MAX_CORE_ENTRY_BYTES = 5_242_880
const MAX_TOTAL_CORE_BYTES = 52_428_800
const MAX_MANIFEST_PAYLOAD_BYTES = 2_097_152

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const LOGICAL_ID_PATTERN = /^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/
const KEY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

function decodedBase64urlByteLength(value: string): number {
	return Math.floor((value.length * 3) / 4)
}

function isCanonicalBase64url(value: string, maximumDecodedBytes: number): boolean {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return false
	if (decodedBase64urlByteLength(value) > maximumDecodedBytes) return false

	const remainder = value.length % 4
	if (remainder === 0) return true

	const finalValue = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? "")
	if (finalValue < 0) return false

	return remainder === 2 ? (finalValue & 0b1111) === 0 : (finalValue & 0b11) === 0
}

const UnpaddedBase64urlSchema = (maximumDecodedBytes: number) =>
	z
		.string()
		.min(1)
		.refine(
			value => isCanonicalBase64url(value, maximumDecodedBytes),
			"Use canonical unpadded base64url within the decoded byte limit"
		)

export const PisoCampBundleEnvelopeSchema = z
	.object({
		schemaVersion: z.literal(1),
		algorithm: z.literal("Ed25519"),
		keyId: z.string().min(1).max(64).regex(KEY_ID_PATTERN),
		payload: UnpaddedBase64urlSchema(MAX_MANIFEST_PAYLOAD_BYTES),
		signature: UnpaddedBase64urlSchema(64).refine(
			value => decodedBase64urlByteLength(value) === 64,
			"Ed25519 signatures must decode to exactly 64 bytes"
		),
	})
	.strict()

const KIND_MEDIA_TYPES = {
	content: ["application/json"],
	image: ["image/png", "image/jpeg", "image/webp"],
	model: ["model/gltf-binary"],
} as const satisfies Record<string, readonly string[]>

export const PisoCampBundleManifestEntrySchema = z
	.object({
		logicalId: z.string().min(1).max(160).regex(LOGICAL_ID_PATTERN),
		kind: z.enum(["content", "image", "model"]),
		delivery: z.enum(["core", "on_demand"]),
		mediaType: z.enum([
			"application/json",
			"image/png",
			"image/jpeg",
			"image/webp",
			"model/gltf-binary",
		]),
		byteLength: z.number().int().positive(),
		sha256: z.string().regex(SHA256_PATTERN),
		downloadPath: z.string(),
		contentItemId: z.uuid().optional(),
		contentVersionId: z.uuid().optional(),
	})
	.strict()
	.superRefine((entry, context) => {
		// A kind names how a client renders the bytes, so the two can never
		// disagree: an image entry claiming JSON would reach an image decoder.
		const expectedMediaTypes: readonly string[] = KIND_MEDIA_TYPES[entry.kind]
		if (!expectedMediaTypes.includes(entry.mediaType)) {
			context.addIssue({
				code: "custom",
				message: `A ${entry.kind} entry cannot declare ${entry.mediaType}`,
				path: ["mediaType"],
			})
		}

		if (entry.delivery === "core" && entry.byteLength > MAX_CORE_ENTRY_BYTES) {
			context.addIssue({
				code: "custom",
				message: `Core entries cannot exceed ${MAX_CORE_ENTRY_BYTES} bytes`,
				path: ["byteLength"],
			})
		}

		if ((entry.contentItemId === undefined) !== (entry.contentVersionId === undefined)) {
			context.addIssue({
				code: "custom",
				message: "contentItemId and contentVersionId must be present together",
				path: entry.contentItemId === undefined ? ["contentItemId"] : ["contentVersionId"],
			})
		}

		if (entry.downloadPath !== `/pisocamp/bundle/resources/${entry.sha256}`) {
			context.addIssue({
				code: "custom",
				message: "downloadPath must address the entry SHA-256 through the bundle resource route",
				path: ["downloadPath"],
			})
		}
	})

export const PisoCampBundleManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		bundleVersion: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
		generatedAt: z.iso
			.datetime()
			.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC"),
		minimumClientSchemaVersion: z.literal(1),
		entries: z.array(PisoCampBundleManifestEntrySchema).max(MAX_MANIFEST_ENTRIES),
	})
	.strict()
	.superRefine((manifest, context) => {
		let totalCoreBytes = 0

		for (let index = 0; index < manifest.entries.length; index += 1) {
			const entry = manifest.entries[index]
			if (!entry) continue
			const previous = manifest.entries[index - 1]

			if (previous && previous.logicalId >= entry.logicalId) {
				context.addIssue({
					code: "custom",
					message: "Entries must be strictly sorted by unique logicalId",
					path: ["entries", index, "logicalId"],
				})
			}

			if (entry.delivery === "core") totalCoreBytes += entry.byteLength
		}

		if (totalCoreBytes > MAX_TOTAL_CORE_BYTES) {
			context.addIssue({
				code: "custom",
				message: `Total core bytes cannot exceed ${MAX_TOTAL_CORE_BYTES}`,
				path: ["entries"],
			})
		}
	})

export type PisoCampBundleEnvelope = z.infer<typeof PisoCampBundleEnvelopeSchema>
export type PisoCampBundleManifest = z.infer<typeof PisoCampBundleManifestSchema>
export type PisoCampBundleManifestEntry = z.infer<typeof PisoCampBundleManifestEntrySchema>
