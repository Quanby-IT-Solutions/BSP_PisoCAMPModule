import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { RetentionDashboard } from "./retention-dashboard"

const useRetention = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useRetentionSummaryQuery: (input: unknown) => useRetention(input),
}))

const summary = {
	from: "2026-04-01",
	to: "2026-04-30",
	timezone: "Asia/Manila" as const,
	churnInactivityDays: 30,
	cohorts: [
		{
			cohortDate: "2026-04-01",
			users: 3,
			d1: { retainedUsers: 2, percent: 66.67 },
			d7: { retainedUsers: 1, percent: 33.33 },
			d30: null,
		},
	],
	knownUsers: 4,
	churnedUsers: 2,
	churnRatePercent: 50,
	lapsedAtRangeStart: 2,
	reengagedUsers: 1,
	reengagementRatePercent: 50,
	churnedAtRangeStart: 1,
	reactivatedUsers: 1,
	reactivationRatePercent: 100,
	averageLifetimeDays: 13.33,
	medianLifetimeDays: 10,
}

describe("RetentionDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useRetention.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("shows each rate with the pool it was computed from", () => {
		render(<RetentionDashboard from="2026-04-01" to="2026-04-30" />)

		expect(screen.getByText("Churn rate")).toBeInTheDocument()
		expect(screen.getByText("2 of 4 quiet past 30 days")).toBeInTheDocument()
		expect(screen.getByText("1 of 2 lapsed at 2026-04-01")).toBeInTheDocument()
		expect(screen.getByText("1 of 1 churned at 2026-04-01")).toBeInTheDocument()
	})

	it("shows lifetime as days rather than a bare number", () => {
		render(<RetentionDashboard from="2026-04-01" to="2026-04-30" />)

		expect(screen.getByText("13.33 days")).toBeInTheDocument()
		expect(screen.getByText("Median 10 days")).toBeInTheDocument()
	})

	it("says a day has not arrived instead of reporting nobody returned", () => {
		render(<RetentionDashboard from="2026-04-01" to="2026-04-30" />)

		expect(screen.getByRole("cell", { name: "66.67% (2)" })).toBeInTheDocument()
		// "Not yet" and 0% are different claims, and only one of them is true.
		expect(screen.getByRole("cell", { name: "Not yet" })).toBeInTheDocument()
	})

	it("says plainly when no cohort started in the range", () => {
		useRetention.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...summary, cohorts: [] },
			refetch: vi.fn(),
		})

		render(<RetentionDashboard from="2026-04-01" to="2026-04-30" />)

		expect(screen.getByText("No cohort started in this range.")).toBeInTheDocument()
	})

	it("says nobody is known rather than a lifetime of nothing", () => {
		useRetention.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...summary, averageLifetimeDays: null, medianLifetimeDays: null },
			refetch: vi.fn(),
		})

		render(<RetentionDashboard from="2026-04-01" to="2026-04-30" />)

		expect(screen.getByText("No users yet")).toBeInTheDocument()
		expect(screen.getByText("Median No users yet")).toBeInTheDocument()
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useRetention.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<RetentionDashboard from="2026-04-01" to="2026-04-30" />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
