import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { TACTILE_PATTERN_IDS, TILT_EFFECT_IDS } from "@repo/contracts"

import {
	buildUnsignedSeedBundle,
	generateCheckedInSeed,
	readSeedSourceImages,
	validateCheckedInSeed,
} from "./pisocamp-seed-bundle.js"

describe("CE-1 packaged currency seed", () => {
	it("builds the frozen five-series catalog as 15 banknotes and 14 coins", async () => {
		const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())

		expect(bundle.documents).toHaveLength(29)
		expect(bundle.documents.filter(document => document.contentType === "banknote")).toHaveLength(
			15
		)
		expect(bundle.documents.filter(document => document.contentType === "coin")).toHaveLength(14)
		expect(new Set(bundle.documents.map(document => document.logicalId)).size).toBe(29)
		expect(bundle.manifest.entries).toHaveLength(32)
		expect(bundle.manifest.entries.map(entry => entry.logicalId)).toEqual(
			[...bundle.manifest.entries.map(entry => entry.logicalId)].sort()
		)
		expect(Object.keys(bundle.resourceIndex)).toEqual([...Object.keys(bundle.resourceIndex)].sort())
	})

	it("orders protocol identifiers without consulting host locale behavior", async () => {
		const originalLocaleCompare = String.prototype.localeCompare
		String.prototype.localeCompare = () => {
			throw new Error("host_locale_was_consulted")
		}

		try {
			const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())
			expect(bundle.manifest.entries).toHaveLength(32)
			expect(Object.keys(bundle.resourceIndex)).toHaveLength(32)
		} finally {
			String.prototype.localeCompare = originalLocaleCompare
		}
	})

	it("uses only catalog-derived conservative copy and meaningful neutral image descriptions", async () => {
		const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())

		for (const document of bundle.documents) {
			expect(document.catalogVersion).toBe("BSP-CURRENCY-2026-08-25")
			expect(document.sourceUrl).toMatch(/^https:\/\/www\.bsp\.gov\.ph\//)
			expect(document.title).toBe(`${document.denominationLabel} — ${document.seriesName}`)
			expect(document.summary).toBe(
				`This offline catalog entry identifies ${document.denominationLabel} in ${document.seriesName}.`
			)
			expect(document.body).toContain("BSP source for current design and security guidance")
			expect(document.imageAlt).toMatch(/neutral fictional .* illustration, not a reproduction/i)
			expect(JSON.stringify(document)).not.toMatch(
				/legal tender|in circulation|official artwork|security feature|portrait|serial number/i
			)
			expect(document.relatedLinks).toEqual([
				{
					label: "Bangko Sentral ng Pilipinas source",
					url: document.sourceUrl,
				},
			])
		}
	})

	it("binds every immutable resource to its hash, byte length, MIME, and PNG magic", async () => {
		const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())

		for (const entry of bundle.manifest.entries) {
			const resource = bundle.resources.get(entry.sha256)
			expect(resource, entry.logicalId).toBeDefined()
			expect(resource!.byteLength).toBe(entry.byteLength)
			expect(resource!.mediaType).toBe(entry.mediaType)
			if (entry.kind === "image") {
				expect(resource!.bytes.subarray(0, 8)).toEqual(
					Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
				)
			}
			if (entry.kind === "model") {
				expect(resource!.bytes.subarray(0, 4).toString("ascii")).toBe("glTF")
				expect(resource!.bytes.readUInt32LE(8)).toBe(resource!.byteLength)
			}
		}
	})


	it("gives every mandatory coin a model and no banknote one", async () => {
		const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())
		const models = bundle.manifest.entries.filter(entry => entry.kind === "model")

		expect(models).toHaveLength(1)
		expect(models[0]?.logicalId).toBe("model.seed.coin-education")
		expect(models[0]?.mediaType).toBe("model/gltf-binary")
		// Core, so a first-run device can open the 3D view with no network.
		expect(models[0]?.delivery).toBe("core")

		const coins = bundle.documents.filter(document => document.contentType === "coin")
		expect(coins).toHaveLength(14)
		for (const coin of coins) {
			expect(coin.modelSha256, coin.logicalId).toBe(models[0]?.sha256)
			expect(coin.modelAlt, coin.logicalId).toContain("not a reproduction")
		}
		for (const banknote of bundle.documents.filter(
			document => document.contentType === "banknote"
		)) {
			expect(banknote.modelSha256, banknote.logicalId).toBeUndefined()
			expect(banknote.modelAlt, banknote.logicalId).toBeUndefined()
		}
	})


	it("gives every mandatory banknote a tactile map and no coin one", async () => {
		const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())
		const banknotes = bundle.documents.filter(
			document => document.contentType === "banknote"
		)
		const coins = bundle.documents.filter(document => document.contentType === "coin")

		expect(banknotes).toHaveLength(15)
		for (const banknote of banknotes) {
			expect(banknote.tactileRegions, banknote.logicalId).toBeDefined()
			expect(banknote.tactileRegions!.length, banknote.logicalId).toBeGreaterThan(0)
			for (const region of banknote.tactileRegions!) {
				// Anchored inside the illustration it is drawn on.
				expect(region.x + region.width, region.id).toBeLessThanOrEqual(1000)
				expect(region.y + region.height, region.id).toBeLessThanOrEqual(1000)
				expect(TACTILE_PATTERN_IDS, region.id).toContain(region.pattern)
			}
		}
		for (const coin of coins) {
			expect(coin.tactileRegions, coin.logicalId).toBeUndefined()
		}
	})

	it("gives every mandatory banknote a tilt effect and no coin one", async () => {
		const bundle = buildUnsignedSeedBundle(await readSeedSourceImages())

		for (const banknote of bundle.documents.filter(
			document => document.contentType === "banknote"
		)) {
			const effect = banknote.tiltEffect
			expect(effect, banknote.logicalId).toBeDefined()
			expect(TILT_EFFECT_IDS, banknote.logicalId).toContain(effect!.effect)
			expect(effect!.x + effect!.width, effect!.id).toBeLessThanOrEqual(1000)
			expect(effect!.y + effect!.height, effect!.id).toBeLessThanOrEqual(1000)
		}
		for (const coin of bundle.documents.filter(document => document.contentType === "coin")) {
			expect(coin.tiltEffect, coin.logicalId).toBeUndefined()
		}
	})

	it("reproduces every checked-in generated byte and verifies the frozen signature offline", async () => {
		const output = await mkdtemp(join(tmpdir(), "ce1-seed-"))
		try {
			await generateCheckedInSeed(output)
			const result = await validateCheckedInSeed(output)
			expect(result).toEqual({ entries: 32, documents: 29, networkUsed: false })
			expect(await readFile(join(output, "manifest.envelope.json"))).toEqual(
				await readFile(
					join(
						process.cwd(),
						"..",
						"..",
						"apps",
						"mobile",
						"assets",
						"pisocamp",
						"bundle",
						"seed",
						"manifest.envelope.json"
					)
				)
			)
		} finally {
			await rm(output, { recursive: true, force: true })
		}
	})

	it("contains no private-key, credential, absolute-path, or unauthorized URL material", async () => {
		const result = await validateCheckedInSeed()

		expect(result).toEqual({ entries: 32, documents: 29, networkUsed: false })
	})

	it("retains verification authority only and cannot generate or use private signing keys", async () => {
		const source = await readFile(new URL("./pisocamp-seed-bundle.ts", import.meta.url), "utf8")
		const cryptoImport = source.match(/import\s*\{([^}]+)\}\s*from\s*"node:crypto"/s)
		expect(
			cryptoImport?.[1]
				?.split(",")
				.map(name => name.trim())
				.sort()
		).toEqual(["createHash", "createPublicKey", "verify"])
		expect(source).not.toMatch(
			/\b(?:createPrivateKey|generateKeyPair|generateKeyPairSync|sign)\s*\(/
		)
		expect(source).not.toMatch(
			/\b(?:const|let|var)\s+[A-Za-z0-9_]*(?:privateKey|pkcs8|seedPrivate)[A-Za-z0-9_]*\s*=/i
		)
	})
})
