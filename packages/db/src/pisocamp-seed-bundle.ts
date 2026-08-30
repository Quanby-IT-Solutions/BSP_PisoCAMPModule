import { Buffer } from "node:buffer"
import { createHash, createPublicKey, verify } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import {
	PisoCampBundleEnvelopeSchema,
	PisoCampBundleManifestSchema,
	type PisoCampBundleManifest,
} from "@repo/contracts"

import {
	PISOCAMP_CURRENCY_CATALOG,
	PISOCAMP_CURRENCY_CATALOG_VERSION,
} from "./pisocamp-currency-catalog.js"

const GENERATED_AT = "2026-08-27T00:00:00Z"
const SEED_KEY_ID = "ce1-seed-v1"
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const CHECKED_IN_SEED_ROOT = join(
	REPOSITORY_ROOT,
	"apps",
	"mobile",
	"assets",
	"pisocamp",
	"bundle",
	"seed"
)
const BANKNOTE_SOURCE = "neutral-banknote-education.png"
const COIN_SOURCE = "neutral-coin-education.png"
const PROVENANCE_SOURCE = "SOURCE.md"
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_CORE_ENTRY_BYTES = 5_242_880
const MAX_TOTAL_CORE_BYTES = 52_428_800

// Raw 32-byte Ed25519 public key and signature only. Signing authority is not retained.
export const FROZEN_SEED_PUBLIC_KEY_BASE64URL = "L44qPLFdHh-96BS718yYtGI8Z5zNgDtsEvMEZnqpjy4"
export const FROZEN_SEED_SIGNATURE_BASE64URL =
	"4SFHVqShRdp6_oIbxiu_GviBGXSb1sqBRWlYWmez3VwENXq4DWL9pVuwYeenTQvwBJ-wBsS-z3vLuxxYqdVwBg"

export interface SeedSourceImages {
	banknote: Buffer
	coin: Buffer
}

export interface SeedCurrencyDocument {
	schemaVersion: 1
	logicalId: string
	contentType: "banknote" | "coin"
	seriesCode: string
	seriesName: string
	seriesOrder: number
	denominationCode: string
	denominationLabel: string
	denominationOrder: number
	title: string
	summary: string
	body: string
	catalogVersion: string
	sourceUrl: string
	imageSha256: string
	imageAlt: string
	relatedLinks: { label: string; url: string }[]
}

interface SeedResource {
	bytes: Buffer
	byteLength: number
	mediaType: "application/json" | "image/png"
	fileName: string
}

export interface UnsignedSeedBundle {
	documents: SeedCurrencyDocument[]
	manifest: PisoCampBundleManifest
	payload: Buffer
	resources: Map<string, SeedResource>
	resourceIndex: Record<string, string>
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex")
}

function canonicalJson(value: unknown): Buffer {
	return Buffer.from(JSON.stringify(value), "utf8")
}

function compareCodeUnits(left: string, right: string): number {
	if (left === right) return 0
	return left < right ? -1 : 1
}

function imageEntry(
	logicalId: string,
	bytes: Buffer,
	fileName: string
): { entry: PisoCampBundleManifest["entries"][number]; digest: string; resource: SeedResource } {
	if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) throw new Error("seed_image_not_png")
	if (bytes.byteLength > MAX_CORE_ENTRY_BYTES) throw new Error("seed_image_too_large")
	const digest = sha256(bytes)
	return {
		digest,
		entry: {
			logicalId,
			kind: "image",
			delivery: "core",
			mediaType: "image/png",
			byteLength: bytes.byteLength,
			sha256: digest,
			downloadPath: `/pisocamp/bundle/resources/${digest}`,
		},
		resource: { bytes, byteLength: bytes.byteLength, mediaType: "image/png", fileName },
	}
}

export async function readSeedSourceImages(
	seedRoot = CHECKED_IN_SEED_ROOT
): Promise<SeedSourceImages> {
	return {
		banknote: await readFile(join(seedRoot, "source", BANKNOTE_SOURCE)),
		coin: await readFile(join(seedRoot, "source", COIN_SOURCE)),
	}
}

export function buildUnsignedSeedBundle(images: SeedSourceImages): UnsignedSeedBundle {
	const banknote = imageEntry(
		"image.seed.banknote-education",
		images.banknote,
		join("source", BANKNOTE_SOURCE)
	)
	const coin = imageEntry("image.seed.coin-education", images.coin, join("source", COIN_SOURCE))
	const resources = new Map<string, SeedResource>([
		[banknote.digest, banknote.resource],
		[coin.digest, coin.resource],
	])
	const documents: SeedCurrencyDocument[] = []
	const entries: PisoCampBundleManifest["entries"] = [banknote.entry, coin.entry]

	PISOCAMP_CURRENCY_CATALOG.forEach((currencySeries, seriesOrder) => {
		currencySeries.denominations.forEach(currencyDenomination => {
			const logicalId = `catalog.${currencySeries.code}.${currencyDenomination.code}`
			const chosenImage = currencySeries.mediaKind === "banknote" ? banknote : coin
			const kindLabel = currencySeries.mediaKind === "banknote" ? "banknote" : "coin"
			const document: SeedCurrencyDocument = {
				schemaVersion: 1,
				logicalId,
				contentType: currencySeries.mediaKind,
				seriesCode: currencySeries.code,
				seriesName: currencySeries.name,
				seriesOrder,
				denominationCode: currencyDenomination.code,
				denominationLabel: currencyDenomination.label,
				denominationOrder: currencyDenomination.sortOrder,
				title: `${currencyDenomination.label} — ${currencySeries.name}`,
				summary: `This offline catalog entry identifies ${currencyDenomination.label} in ${currencySeries.name}.`,
				body: "This offline baseline identifies the catalog entry. See the linked BSP source for current design and security guidance.",
				catalogVersion: PISOCAMP_CURRENCY_CATALOG_VERSION,
				sourceUrl: currencySeries.sourceUrl,
				imageSha256: chosenImage.digest,
				imageAlt: `A neutral fictional ${kindLabel} education illustration, not a reproduction.`,
				relatedLinks: [
					{
						label: "Bangko Sentral ng Pilipinas source",
						url: currencySeries.sourceUrl,
					},
				],
			}
			const bytes = canonicalJson(document)
			const digest = sha256(bytes)
			documents.push(document)
			resources.set(digest, {
				bytes,
				byteLength: bytes.byteLength,
				mediaType: "application/json",
				fileName: join("resources", `${digest}.json`),
			})
			entries.push({
				logicalId,
				kind: "content",
				delivery: "core",
				mediaType: "application/json",
				byteLength: bytes.byteLength,
				sha256: digest,
				downloadPath: `/pisocamp/bundle/resources/${digest}`,
			})
		})
	})

	entries.sort((left, right) => compareCodeUnits(left.logicalId, right.logicalId))
	const manifest = PisoCampBundleManifestSchema.parse({
		schemaVersion: 1,
		bundleVersion: "0",
		generatedAt: GENERATED_AT,
		minimumClientSchemaVersion: 1,
		entries,
	})
	const totalCoreBytes = entries.reduce((total, entry) => total + entry.byteLength, 0)
	if (totalCoreBytes > MAX_TOTAL_CORE_BYTES) throw new Error("seed_total_core_too_large")
	const resourceIndex = Object.fromEntries(
		[...resources.entries()]
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([digest, resource]) => [
				digest,
				`assets/pisocamp/bundle/seed/${resource.fileName.replaceAll("\\", "/")}`,
			])
	)
	return { documents, manifest, payload: canonicalJson(manifest), resources, resourceIndex }
}

function publicKeyFromRaw(base64url: string) {
	const raw = Buffer.from(base64url, "base64url")
	if (raw.byteLength !== 32 || raw.toString("base64url") !== base64url) {
		throw new Error("seed_public_key_invalid")
	}
	return createPublicKey({
		key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
		format: "der",
		type: "spki",
	})
}

function signedEnvelope(bundle: UnsignedSeedBundle): Buffer {
	const signature = Buffer.from(FROZEN_SEED_SIGNATURE_BASE64URL, "base64url")
	if (
		signature.byteLength !== 64 ||
		signature.toString("base64url") !== FROZEN_SEED_SIGNATURE_BASE64URL ||
		!verify(null, bundle.payload, publicKeyFromRaw(FROZEN_SEED_PUBLIC_KEY_BASE64URL), signature)
	) {
		throw new Error("seed_signature_invalid")
	}
	return canonicalJson({
		schemaVersion: 1,
		algorithm: "Ed25519",
		keyId: SEED_KEY_ID,
		payload: bundle.payload.toString("base64url"),
		signature: FROZEN_SEED_SIGNATURE_BASE64URL,
	})
}

async function writeArtifact(root: string, fileName: string, bytes: Uint8Array): Promise<void> {
	const path = join(root, fileName)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, bytes)
}

export async function generateCheckedInSeed(outputDirectory = CHECKED_IN_SEED_ROOT): Promise<void> {
	const images = await readSeedSourceImages()
	const bundle = buildUnsignedSeedBundle(images)
	await writeArtifact(
		outputDirectory,
		PROVENANCE_SOURCE,
		await readFile(join(CHECKED_IN_SEED_ROOT, PROVENANCE_SOURCE))
	)
	await writeArtifact(outputDirectory, "manifest.envelope.json", signedEnvelope(bundle))
	await writeArtifact(outputDirectory, "resource-index.json", canonicalJson(bundle.resourceIndex))
	for (const resource of bundle.resources.values()) {
		await writeArtifact(outputDirectory, resource.fileName, resource.bytes)
	}
}

async function listFiles(root: string, current = root): Promise<string[]> {
	const found: string[] = []
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const path = join(current, entry.name)
		if (entry.isDirectory()) found.push(...(await listFiles(root, path)))
		else found.push(relative(root, path).replaceAll("\\", "/"))
	}
	return found.sort()
}

export async function validateCheckedInSeed(
	seedRoot = CHECKED_IN_SEED_ROOT
): Promise<{ entries: number; documents: number; networkUsed: false }> {
	const expected = buildUnsignedSeedBundle(await readSeedSourceImages(seedRoot))
	const envelopeBytes = await readFile(join(seedRoot, "manifest.envelope.json"))
	const envelope = PisoCampBundleEnvelopeSchema.parse(JSON.parse(envelopeBytes.toString("utf8")))
	if (!envelopeBytes.equals(signedEnvelope(expected))) throw new Error("seed_envelope_drift")
	if (!Buffer.from(envelope.payload, "base64url").equals(expected.payload)) {
		throw new Error("seed_payload_drift")
	}
	const indexBytes = await readFile(join(seedRoot, "resource-index.json"))
	if (!indexBytes.equals(canonicalJson(expected.resourceIndex))) throw new Error("seed_index_drift")

	for (const [digest, resource] of expected.resources) {
		const actual = await readFile(join(seedRoot, resource.fileName))
		if (!actual.equals(resource.bytes) || sha256(actual) !== digest)
			throw new Error("seed_resource_drift")
	}

	const expectedFiles = [
		PROVENANCE_SOURCE,
		"manifest.envelope.json",
		"resource-index.json",
		...new Set(
			[...expected.resources.values()].map(resource => resource.fileName.replaceAll("\\", "/"))
		),
	].sort()
	const actualFiles = await listFiles(seedRoot)
	if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
		throw new Error("seed_file_set_drift")

	for (const fileName of actualFiles.filter(
		file => file.endsWith(".json") || file.endsWith(".md")
	)) {
		const text = (await readFile(join(seedRoot, fileName), "utf8")).toString()
		if (/-----BEGIN (?:PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----|PKCS#8/i.test(text)) {
			throw new Error("seed_private_key_material")
		}
		if (/password|secret|credential|session[_-]?token|database_url/i.test(text)) {
			throw new Error("seed_credential_material")
		}
		if (fileName.endsWith(".json") && /official artwork|legal tender|in circulation/i.test(text)) {
			throw new Error("seed_unapproved_claim")
		}
		if (/[A-Za-z]:\\|\/(?:Users|home|tmp)\//.test(text)) throw new Error("seed_absolute_path")
		for (const url of text.match(/https?:\/\/[^"\\]+/g) ?? []) {
			if (!url.startsWith("https://www.bsp.gov.ph/")) throw new Error("seed_unexpected_url")
		}
	}

	return {
		entries: expected.manifest.entries.length,
		documents: expected.documents.length,
		networkUsed: false,
	}
}

async function main(): Promise<void> {
	const mode = process.argv[2]
	if (mode === "generate") await generateCheckedInSeed()
	else if (mode === "validate") await validateCheckedInSeed()
	else throw new Error("Usage: pisocamp-seed-bundle <generate|validate>")
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	void main().catch(error => {
		process.stderr.write(`${error instanceof Error ? error.message : "seed_bundle_failed"}\n`)
		process.exitCode = 1
	})
}
