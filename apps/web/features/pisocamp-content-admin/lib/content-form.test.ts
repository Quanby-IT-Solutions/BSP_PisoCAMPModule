import { describe, expect, it, vi } from "vitest"

import { PISOCAMP_CURRENCY_CATALOG } from "../../../../../packages/db/src/pisocamp-currency-catalog"
import {
	buildCreateContentRequest,
	buildUpdateContentRequest,
	changeContentType,
	changeCurrencySeries,
	createEmptyContentForm,
	CURRENCY_SERIES_OPTIONS,
	getDenominationOptions,
	getOrCreateRequestId,
	getSeriesOptions,
	type ContentFormValues,
} from "./content-form"

const requestId = "d7ef42f1-5a30-4fa7-9da5-c3af0d0bbb36"
const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"

function validAdvisory(overrides: Partial<ContentFormValues> = {}): ContentFormValues {
	return {
		...createEmptyContentForm("advisory"),
		title: " Counterfeit advisory ",
		summary: " How to identify suspect notes. ",
		body: " Bring suspect notes to an authorized bank. ",
		...overrides,
	}
}

describe("Piso CAMP content form model", () => {
	it("normalizes contract text and omits forbidden fields for the selected type", () => {
		const result = buildCreateContentRequest(
			validAdvisory({
				seriesCode: "ngc-banknotes",
				denominationCode: "php-100",
				primaryUrl: "https://example.com/ignored",
			}),
			requestId
		)

		expect(result).toEqual({
			success: true,
			data: {
				requestId,
				content: {
					contentType: "advisory",
					title: "Counterfeit advisory",
					summary: "How to identify suspect notes.",
					body: "Bring suspect notes to an authorized bank.",
				},
				relatedLinks: [],
			},
		})
	})

	it("switches among all five types while preserving common fields and clearing forbidden ones", () => {
		let values = validAdvisory()
		for (const type of ["banknote", "coin", "security_feature", "link", "advisory"] as const) {
			values = changeContentType(values, type)
			expect(values.contentType).toBe(type)
			expect(values.title).toBe(" Counterfeit advisory ")
		}

		values = changeContentType(
			{ ...values, seriesCode: "ngc-banknotes", denominationCode: "php-100" },
			"link"
		)
		expect(values.seriesCode).toBe("")
		expect(values.denominationCode).toBe("")
	})

	it("filters series by type and resets a denomination invalid for the new series", () => {
		expect(getSeriesOptions("banknote").map(option => option.code)).toEqual([
			"fpp-banknotes",
			"engc-banknotes",
			"ngc-banknotes",
		])
		expect(getSeriesOptions("coin").map(option => option.code)).toEqual([
			"ngc-coins",
			"bsp-coin-series",
		])
		expect(getSeriesOptions("security_feature")).toHaveLength(5)
		expect(getSeriesOptions("advisory")).toEqual([])
		expect(getDenominationOptions("ngc-banknotes").map(option => option.code)).toContain("php-200")

		const changed = changeCurrencySeries(
			{
				...createEmptyContentForm("security_feature"),
				seriesCode: "ngc-banknotes",
				denominationCode: "php-200",
			},
			"fpp-banknotes"
		)
		expect(changed.seriesCode).toBe("fpp-banknotes")
		expect(changed.denominationCode).toBe("")
	})

	it.each([
		["external", { kind: "external", label: "BSP", value: "http://insecure.example" }],
		["internal", { kind: "internal", label: "Guide", value: "Not/A/Route" }],
		["topic", { kind: "topic", label: "Related", value: "not-a-uuid" }],
	] as const)("uses the contract union to reject an invalid %s related link", (_kind, link) => {
		const result = buildCreateContentRequest(
			validAdvisory({ relatedLinks: [{ clientId: "link-1", ...link }] }),
			requestId
		)

		expect(result.success).toBe(false)
		if (!result.success) expect(result.errors["relatedLinks.0.value"]).toBeTruthy()
	})

	it("returns understandable required-field errors from the final contract validator", () => {
		const result = buildCreateContentRequest(validAdvisory({ title: "", body: "" }), requestId)

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.errors.title).toMatch(/required/i)
			expect(result.errors.body).toMatch(/required/i)
		}
	})

	it("translates conditional and nested contract issues into control-specific messages", () => {
		const currency = buildCreateContentRequest(
			{
				...validAdvisory(),
				contentType: "banknote",
				seriesCode: "",
				denominationCode: "",
			},
			requestId
		)
		expect(currency).toEqual(
			expect.objectContaining({
				success: false,
				errors: expect.objectContaining({
					seriesCode: "Currency series is required.",
					denominationCode: "Denomination is required.",
				}),
			})
		)

		const links = buildCreateContentRequest(
			validAdvisory({
				relatedLinks: [
					{ clientId: "first", kind: "external", label: "", value: "" },
					{ clientId: "second", kind: "topic", label: "Topic", value: "not-a-uuid" },
				],
			}),
			requestId
		)
		expect(links).toEqual(
			expect.objectContaining({
				success: false,
				errors: expect.objectContaining({
					"relatedLinks.0.label": "Related link 1 label is required.",
					"relatedLinks.0.value": "Related link 1 must use a valid HTTPS URL.",
					"relatedLinks.1.value": "Related link 2 must reference a valid content item ID.",
				}),
			})
		)
	})

	it("matches the canonical five-series, 29-denomination catalog projection", () => {
		const canonicalProjection = PISOCAMP_CURRENCY_CATALOG.map(
			({ code, name, mediaKind, denominations }) => ({
				code,
				label: name,
				mediaKind,
				denominations: denominations.map(({ code: denominationCode, label }) => ({
					code: denominationCode,
					label,
				})),
			})
		)
		expect(CURRENCY_SERIES_OPTIONS).toEqual(canonicalProjection)
		expect(canonicalProjection).toHaveLength(5)
		expect(canonicalProjection.flatMap(series => series.denominations)).toHaveLength(29)
	})

	it("builds an immutable edit request with the expected version", () => {
		const values = validAdvisory()
		const snapshot = structuredClone(values)
		const result = buildUpdateContentRequest(values, {
			itemId,
			requestId,
			expectedVersionNo: 3,
		})

		expect(values).toEqual(snapshot)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data).toEqual(
				expect.objectContaining({ itemId, requestId, expectedVersionNo: 3 })
			)
		}
	})

	it("generates a request id once and reuses it for retries", () => {
		const generate = vi.fn(() => requestId)
		const first = getOrCreateRequestId(null, generate)
		const retry = getOrCreateRequestId(first, generate)

		expect(first).toBe(requestId)
		expect(retry).toBe(requestId)
		expect(generate).toHaveBeenCalledTimes(1)
	})
})
