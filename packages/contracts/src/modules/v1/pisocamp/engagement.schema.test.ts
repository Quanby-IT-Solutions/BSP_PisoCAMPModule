import { describe, expect, it } from "vitest"

import {
	EngagementRangeInputSchema,
	EngagementSummarySchema,
} from "./engagement.schema.js"

const summary = {
	from: "2026-08-10",
	to: "2026-08-11",
	timezone: "Asia/Manila",
	sessionInactivityMinutes: 30,
	dau: 1,
	mau: 2,
	dauMauPercent: 50,
	sessions: 4,
	activeUsers: 2,
	sessionsPerUser: 2,
	averageSessionSeconds: 300,
	screenViewsPerSession: 1.25,
	dailyActive: [{ date: "2026-08-10", activeUsers: 2 }],
	hourly: Array.from({ length: 24 }, (_value, hour) => ({ hour, sessions: 0 })),
	peakConcurrency: { intervalStart: "2026-08-10T02:30:00.000Z", sessions: 2 },
}

describe("EngagementRangeInputSchema", () => {
	it("takes a range of Asia/Manila days", () => {
		expect(
			EngagementRangeInputSchema.safeParse({ from: "2026-08-10", to: "2026-08-11" }).success
		).toBe(true)
		expect(
			EngagementRangeInputSchema.safeParse({ from: "2026-08-10", to: "2026-08-10" }).success
		).toBe(true)
	})

	it("refuses a range that ends before it starts", () => {
		expect(
			EngagementRangeInputSchema.safeParse({ from: "2026-08-11", to: "2026-08-10" }).success
		).toBe(false)
	})

	it("refuses a range longer than a year", () => {
		// A dashboard query that scans years is a query that times out on
		// somebody's screen rather than answering.
		expect(
			EngagementRangeInputSchema.safeParse({ from: "2025-08-09", to: "2026-08-11" }).success
		).toBe(false)
		// 366 days inclusive is a leap year, and a year is what a dashboard asks
		// for; 367 is the one that is refused.
		expect(
			EngagementRangeInputSchema.safeParse({ from: "2025-08-10", to: "2026-08-11" }).success
		).toBe(true)
	})

	it("refuses a timestamp where a day belongs", () => {
		expect(
			EngagementRangeInputSchema.safeParse({
				from: "2026-08-10T00:00:00Z",
				to: "2026-08-11",
			}).success
		).toBe(false)
	})
})

describe("EngagementSummarySchema", () => {
	it("takes the whole summary", () => {
		expect(EngagementSummarySchema.safeParse(summary).success).toBe(true)
		expect(
			EngagementSummarySchema.safeParse({ ...summary, peakConcurrency: null }).success
		).toBe(true)
	})

	it("insists on all twenty-four hours", () => {
		// A missing hour would read as a quiet hour rather than a missing one.
		expect(
			EngagementSummarySchema.safeParse({ ...summary, hourly: summary.hourly.slice(1) })
				.success
		).toBe(false)
	})

	it.each([
		["a ratio over a hundred", { dauMauPercent: 101 }],
		["a negative count", { sessions: -1 }],
		["a fractional user count", { activeUsers: 1.5 }],
		["another timezone", { timezone: "UTC" }],
		["an unknown field", { retention: 0.5 }],
	])("refuses %s", (_label, patch) => {
		expect(EngagementSummarySchema.safeParse({ ...summary, ...patch }).success).toBe(false)
	})
})
