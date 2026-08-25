import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
	PISOCAMP_LOCATION_CATALOG,
	PISOCAMP_LOCATION_CATALOG_SHA256,
	PISOCAMP_LOCATION_PROVENANCE,
	PISOCAMP_LOCATION_SOURCE_URL,
	PISOCAMP_LOCATION_VERSION,
} from "./pisocamp-location-catalog.js"

describe("official PSA PSGC 2Q 2026 city catalog", () => {
	it("contains exactly 18 regions and 149 city-level entries with valid unique codes", () => {
		const cities = PISOCAMP_LOCATION_CATALOG.flatMap(region =>
			region.cities.map(city => ({ ...city, regionCode: region.code }))
		)
		expect(PISOCAMP_LOCATION_CATALOG).toHaveLength(18)
		expect(cities).toHaveLength(149)
		expect(new Set(PISOCAMP_LOCATION_CATALOG.map(region => region.code)).size).toBe(18)
		expect(new Set(cities.map(city => city.code)).size).toBe(149)
		expect(
			PISOCAMP_LOCATION_CATALOG.every(
				region => /^\d{10}$/.test(region.code) && region.name === region.name.trim()
			)
		).toBe(true)
		expect(cities.every(city => /^\d{10}$/.test(city.code) && city.name === city.name.trim())).toBe(
			true
		)
		expect(
			PISOCAMP_LOCATION_CATALOG.find(region => region.code === "1800000000")?.cities
		).toHaveLength(19)
	})

	it("pins provenance and the digest of the normalized catalog", () => {
		expect(PISOCAMP_LOCATION_VERSION).toBe("PSGC-2Q-2026")
		expect(PISOCAMP_LOCATION_SOURCE_URL).toBe("https://psa.gov.ph/classification/psgc/summary")
		expect(
			createHash("sha256").update(JSON.stringify(PISOCAMP_LOCATION_CATALOG)).digest("hex")
		).toBe(PISOCAMP_LOCATION_CATALOG_SHA256)
		expect(PISOCAMP_LOCATION_CATALOG_SHA256).toBe(
			"d346ceb5d7ecc4f6ead8471e4b498542c5ce91ae37b179904893ef2ec7f4667c"
		)
	})

	it("reconciles every official per-region HTML table", () => {
		expect(PISOCAMP_LOCATION_PROVENANCE.map(page => page.expectedCityCount)).toEqual([
			9, 4, 15, 22, 7, 3, 10, 7, 5, 9, 6, 4, 16, 2, 6, 2, 19, 3,
		])
		for (const page of PISOCAMP_LOCATION_PROVENANCE) {
			expect(page.url).toBe(`https://psa.gov.ph/classification/psgc/cities/${page.regionCode}`)
			expect(
				PISOCAMP_LOCATION_CATALOG.find(region => region.code === page.regionCode)?.cities
			).toHaveLength(page.expectedCityCount)
		}
	})
})
