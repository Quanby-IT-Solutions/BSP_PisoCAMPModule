import { describe, expect, it } from "vitest"

import {
	DEMOGRAPHIC_FILTER_KEYS,
	GenerateReportInputSchema,
	REPORT_DEFINITIONS,
	REPORT_FILTER_KEYS,
	ListReportRunsInputSchema,
	ReportFiltersSchema,
	ReportRunSchema,
} from "./report.schema.js"

const request = {
	id: "6f6e3f1e-6c5a-4a1f-9d4a-4b9f4f7f4d21",
	definitionKey: "activity",
	from: "2026-08-10",
	to: "2026-08-11",
	filters: { os: "android" },
}

const run = {
	id: request.id,
	definitionKey: "activity",
	definitionName: "Activity",
	dataSource: "analytics_event",
	generatedAt: "2026-08-12T02:00:00.000Z",
	generatedBy: "user-1",
	from: "2026-08-10",
	to: "2026-08-11",
	timezone: "Asia/Manila",
	filters: { os: "android" },
	suppressed: false,
	suppressionReason: null,
	result: {
		definitionKey: "activity",
		activity: {
			from: "2026-08-10",
			to: "2026-08-11",
			timezone: "Asia/Manila",
			totalEvents: 3,
			distinctUsers: 2,
			byEvent: [{ eventName: "module_entry", events: 2, users: 2 }],
			byDay: [{ date: "2026-08-10", events: 3 }],
		},
	},
}

describe("REPORT_DEFINITIONS", () => {
	it("only claims filters from the approved list", () => {
		// A report that supported a filter §4.2-K never approved would be a
		// filter nobody agreed to, arriving through the back door.
		for (const definition of REPORT_DEFINITIONS) {
			for (const filter of definition.filters) {
				expect(REPORT_FILTER_KEYS).toContain(filter)
			}
		}
	})

	it("never claims a demographic filter, which AN-10 owns", () => {
		for (const definition of REPORT_DEFINITIONS) {
			for (const filter of definition.filters) {
				expect(DEMOGRAPHIC_FILTER_KEYS).not.toContain(filter)
			}
		}
	})

	it("names every report exactly once", () => {
		const keys = REPORT_DEFINITIONS.map(definition => definition.key)
		expect(new Set(keys).size).toBe(keys.length)
	})
})

describe("GenerateReportInputSchema", () => {
	it("takes a request with an id, a period and filters", () => {
		expect(GenerateReportInputSchema.safeParse(request).success).toBe(true)
	})

	it("defaults to no filters at all", () => {
		const parsed = GenerateReportInputSchema.parse({ ...request, filters: undefined })
		expect(parsed.filters).toEqual({})
	})

	it.each([
		["a range that ends before it starts", { from: "2026-08-12" }],
		["a range longer than a year", { from: "2025-08-09" }],
		["an unknown report", { definitionKey: "not-a-report" }],
		["an id that is not a uuid", { id: "1" }],
		["an unknown field", { unexpected: true }],
	])("refuses %s", (_label, patch) => {
		expect(GenerateReportInputSchema.safeParse({ ...request, ...patch }).success).toBe(false)
	})

	it("refuses a filter outside the approved list", () => {
		expect(
			GenerateReportInputSchema.safeParse({
				...request,
				filters: { somethingElse: "x" },
			}).success
		).toBe(false)
	})

	it("takes each approved filter", () => {
		// The list is the contract; every key on it has to parse, or the report
		// screen would offer a filter the server refuses.
		for (const key of REPORT_FILTER_KEYS) {
			const value =
				key === "userType"
					? "guest"
					: key === "gender"
						? "female"
						: key === "device"
							? "phone"
							: key === "os"
								? "android"
								: key === "region" || key === "city"
									? "0123456789"
									: "value"
			expect(ReportFiltersSchema.safeParse({ [key]: value }).success).toBe(true)
		}
	})
})

describe("ListReportRunsInputSchema", () => {
	it("takes the limit the way a query string carries it", () => {
		// The history is fetched over GET, so the limit arrives as text; a
		// schema that only took a number refused every request the page made.
		expect(ListReportRunsInputSchema.parse({ limit: "20" })).toEqual({ limit: 20 })
	})

	it("defaults the limit when none is asked for", () => {
		expect(ListReportRunsInputSchema.parse({})).toEqual({ limit: 20 })
	})

	it("refuses a limit outside the range", () => {
		expect(ListReportRunsInputSchema.safeParse({ limit: "0" }).success).toBe(false)
		expect(ListReportRunsInputSchema.safeParse({ limit: "101" }).success).toBe(false)
	})
})

describe("ReportRunSchema", () => {
	it("takes a completed run", () => {
		expect(ReportRunSchema.safeParse(run).success).toBe(true)
	})

	it("takes a withheld run with a reason and no figures", () => {
		expect(
			ReportRunSchema.safeParse({
				...run,
				suppressed: true,
				suppressionReason: "Demographic filters wait for AN-10.",
				result: null,
			}).success
		).toBe(true)
	})

	it("refuses figures that do not match the report they claim to be", () => {
		expect(
			ReportRunSchema.safeParse({
				...run,
				result: { definitionKey: "engagement", activity: run.result.activity },
			}).success
		).toBe(false)
	})
})
