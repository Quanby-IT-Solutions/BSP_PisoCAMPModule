import { describe, expect, it } from "vitest"

import { CONTENT_STATUSES, CONTENT_TYPES } from "@repo/contracts"

import {
	PISOCAMP_CURRENCY_CATALOG,
	PISOCAMP_CURRENCY_CATALOG_VERSION,
} from "./pisocamp-currency-catalog.js"

const expectedDenominationCodes = {
	"fpp-banknotes": ["php-50", "php-100", "php-500", "php-1000"],
	"engc-banknotes": ["php-50", "php-100", "php-200", "php-500", "php-1000"],
	"ngc-banknotes": ["php-20", "php-50", "php-100", "php-200", "php-500", "php-1000"],
	"ngc-coins": ["sentimo-1", "sentimo-5", "sentimo-25", "php-1", "php-5", "php-10", "php-20"],
	"bsp-coin-series": [
		"sentimo-1",
		"sentimo-5",
		"sentimo-10",
		"sentimo-25",
		"php-1",
		"php-5",
		"php-10",
	],
} as const

describe("CM-1 frozen content vocabulary and currency catalog", () => {
	it("uses the exact eight content types and seven lifecycle states", () => {
		expect(CONTENT_TYPES).toEqual([
			"banknote",
			"coin",
			"security_feature",
			"advisory",
			"link",
			"trivia_question",
			"survey",
			// AR-2. Listed here on purpose: this is the drift test that says out
			// loud when the vocabulary changes.
			"ar_experience",
		])
		expect(CONTENT_STATUSES).toEqual([
			"draft",
			"submitted_for_review",
			"approved",
			"published",
			"unpublished",
			"deactivated",
			"archived",
		])
	})

	it("pins five official BSP series and exactly 29 composite denomination rows", () => {
		expect(PISOCAMP_CURRENCY_CATALOG_VERSION).toBe("BSP-CURRENCY-2026-08-25")
		expect(PISOCAMP_CURRENCY_CATALOG.map(series => series.code)).toEqual([
			"fpp-banknotes",
			"engc-banknotes",
			"ngc-banknotes",
			"ngc-coins",
			"bsp-coin-series",
		])
		expect(PISOCAMP_CURRENCY_CATALOG).toHaveLength(5)
		expect(PISOCAMP_CURRENCY_CATALOG.flatMap(series => series.denominations)).toHaveLength(29)

		for (const series of PISOCAMP_CURRENCY_CATALOG) {
			expect(series.mediaKind).toBe(series.code.endsWith("banknotes") ? "banknote" : "coin")
			expect(series.catalogVersion).toBe(PISOCAMP_CURRENCY_CATALOG_VERSION)
			expect(series.sourceUrl).toMatch(/^https:\/\/www\.bsp\.gov\.ph\//)
			expect(series.denominations.map(row => row.code)).toEqual(
				expectedDenominationCodes[series.code]
			)
		}
	})

	it("uses stable minor-unit values and has no duplicate composite keys", () => {
		const rows = PISOCAMP_CURRENCY_CATALOG.flatMap(series =>
			series.denominations.map(denomination => ({ seriesCode: series.code, ...denomination }))
		)
		const keys = rows.map(row => `${row.seriesCode}:${row.code}`)
		expect(new Set(keys).size).toBe(rows.length)
		expect(rows.find(row => row.code === "sentimo-1")?.minorUnitValue).toBe(1)
		expect(rows.find(row => row.code === "sentimo-25")?.minorUnitValue).toBe(25)
		expect(rows.find(row => row.code === "php-20")?.minorUnitValue).toBe(2_000)
		expect(rows.find(row => row.code === "php-1000")?.minorUnitValue).toBe(100_000)
	})

	it("is deeply read-only at runtime", () => {
		expect(Object.isFrozen(PISOCAMP_CURRENCY_CATALOG)).toBe(true)
		for (const series of PISOCAMP_CURRENCY_CATALOG) {
			expect(Object.isFrozen(series)).toBe(true)
			expect(Object.isFrozen(series.denominations)).toBe(true)
			for (const denomination of series.denominations) {
				expect(Object.isFrozen(denomination)).toBe(true)
			}
		}
	})
})
