import { describe, expect, it } from "vitest"

import { CohortRetentionSchema, RetentionSummarySchema } from "./retention.schema.js"

const cohort = {
	cohortDate: "2026-08-10",
	users: 4,
	d1: { retainedUsers: 2, percent: 50 },
	d7: { retainedUsers: 1, percent: 25 },
	d30: null,
}

const summary = {
	from: "2026-08-10",
	to: "2026-08-20",
	timezone: "Asia/Manila",
	churnInactivityDays: 30,
	cohorts: [cohort],
	knownUsers: 10,
	churnedUsers: 3,
	churnRatePercent: 30,
	lapsedAtRangeStart: 2,
	reengagedUsers: 1,
	reengagementRatePercent: 50,
	churnedAtRangeStart: 4,
	reactivatedUsers: 1,
	reactivationRatePercent: 25,
	averageLifetimeDays: 6.5,
	medianLifetimeDays: 5,
}

describe("CohortRetentionSchema", () => {
	it("takes a cohort whose later days have not elapsed yet", () => {
		expect(CohortRetentionSchema.safeParse(cohort).success).toBe(true)
	})

	it("refuses a cohort with no members", () => {
		// A cohort is defined by the people who joined on that day; an empty one
		// is a day that started no cohort, and it does not belong in the table.
		expect(CohortRetentionSchema.safeParse({ ...cohort, users: 0 }).success).toBe(false)
	})

	it("refuses retaining more people than joined", () => {
		expect(
			CohortRetentionSchema.safeParse({
				...cohort,
				d1: { retainedUsers: 2, percent: 150 },
			}).success
		).toBe(false)
	})
})

describe("RetentionSummarySchema", () => {
	it("takes the whole summary", () => {
		expect(RetentionSummarySchema.safeParse(summary).success).toBe(true)
	})

	it("takes a summary with nobody in it yet", () => {
		// Null lifetimes, not zero: nobody known is not everybody lasting no time.
		expect(
			RetentionSummarySchema.safeParse({
				...summary,
				cohorts: [],
				knownUsers: 0,
				averageLifetimeDays: null,
				medianLifetimeDays: null,
			}).success
		).toBe(true)
	})

	it.each([
		["an inactivity period of no days", { churnInactivityDays: 0 }],
		["an inactivity period beyond a year", { churnInactivityDays: 366 }],
		["a churn rate over a hundred", { churnRatePercent: 101 }],
		["a negative reactivation count", { reactivatedUsers: -1 }],
		["a negative lifetime", { averageLifetimeDays: -1 }],
		["another timezone", { timezone: "UTC" }],
		["an unknown field", { dau: 1 }],
	])("refuses %s", (_label, patch) => {
		expect(RetentionSummarySchema.safeParse({ ...summary, ...patch }).success).toBe(false)
	})
})
