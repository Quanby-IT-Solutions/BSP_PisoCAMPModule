import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DemographicsDashboard } from "./demographics-dashboard"

const useDemographics = vi.fn()
const useDrilldown = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useDemographicsSummaryQuery: (input: unknown) => useDemographics(input),
	useDemographicDrilldownQuery: (input: unknown) => useDrilldown(input),
}))

const summary = {
	from: "2026-09-01",
	to: "2026-09-30",
	timezone: "Asia/Manila" as const,
	suppressionMinimum: 10,
	consentedUsers: 42,
	withoutConsentUsers: 8,
	distributions: [
		{
			dimension: "gender" as const,
			totalUsers: 42,
			suppressedBuckets: 1,
			buckets: [
				{ key: "female", label: "Female", suppressed: false, users: 30, percent: 71.43 },
				{ key: "male", label: "Male", suppressed: false, users: 11, percent: 26.19 },
				{
					key: "prefer_not_to_say",
					label: "Prefer not to say",
					suppressed: true,
					users: null,
					percent: null,
				},
			],
		},
	],
	dauByGender: {
		dimension: "gender" as const,
		unit: "users" as const,
		suppressedRows: 0,
		rows: [{ key: "female", label: "Female", suppressed: false, users: 30, value: 4.5 }],
	},
	sessionDurationByGender: {
		dimension: "gender" as const,
		unit: "seconds" as const,
		suppressedRows: 0,
		rows: [{ key: "female", label: "Female", suppressed: false, users: 30, value: 612 }],
	},
	retention: [
		{
			dimension: "gender" as const,
			unit: "percent" as const,
			suppressedRows: 0,
			rows: [{ key: "female", label: "Female", suppressed: false, users: 30, value: 40 }],
		},
	],
	churn: [
		{
			dimension: "region" as const,
			unit: "percent" as const,
			suppressedRows: 0,
			rows: [{ key: "NCR", label: "NCR", suppressed: false, users: 30, value: 12.5 }],
		},
	],
}

const drilldown = {
	dimension: "gender" as const,
	bucketKey: "female",
	from: "2026-09-01",
	to: "2026-09-30",
	totalUsers: 30,
	rows: [
		{
			accountId: "user-1",
			name: "Ana Reyes",
			email: "ana@example.test",
			gender: "female" as const,
			age: 31,
			regionCode: "NCR",
			cityCode: "MNL",
			activeDays: 4,
			lastActiveDate: "2026-09-20",
		},
	],
}

describe("DemographicsDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useDemographics.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
		useDrilldown.mockReturnValue({ isPending: false, isError: false, data: drilldown })
	})

	it("says who is counted and who is not", () => {
		render(<DemographicsDashboard canViewPii={false} />)

		expect(screen.getByText(/42 profiles consented/)).toBeInTheDocument()
		expect(screen.getByText(/8 did not/)).toBeInTheDocument()
		expect(screen.getByText(/smaller than 10 is withheld/)).toBeInTheDocument()
	})

	it("marks a suppressed group instead of dropping it", () => {
		render(<DemographicsDashboard canViewPii={false} />)

		// The label stays, because a dropped row would read as nobody at all.
		expect(screen.getByRole("cell", { name: "Prefer not to say" })).toBeInTheDocument()
		expect(
			screen.getByRole("cell", { name: "Withheld (fewer than 10)" })
		).toBeInTheDocument()
	})

	it("shows each cut with the unit it is measured in", () => {
		render(<DemographicsDashboard canViewPii={false} />)

		// Each title appears twice on purpose: once as the card heading and once
		// as the table caption a screen reader announces.
		expect(screen.getAllByText("Daily active users by gender")).toHaveLength(2)
		expect(screen.getAllByText("Session duration by gender")).toHaveLength(2)
		expect(screen.getAllByText("Day-7 retention by gender")).toHaveLength(2)
		expect(screen.getAllByText("Churn by region")).toHaveLength(2)
	})

	it("offers no drill-down without reports.pii.view", () => {
		render(<DemographicsDashboard canViewPii={false} />)

		expect(screen.queryByRole("button", { name: /open female/i })).not.toBeInTheDocument()
		expect(screen.queryByText("ana@example.test")).not.toBeInTheDocument()
	})

	it("opens the drill-down for somebody who may see it", async () => {
		const user = userEvent.setup()
		render(<DemographicsDashboard canViewPii />)

		await user.click(screen.getByRole("button", { name: "Open Female" }))

		expect(screen.getByText("ana@example.test")).toBeInTheDocument()
		expect(
			screen.getByText(/Every open of this panel is recorded against your account/)
		).toBeInTheDocument()
		expect(useDrilldown).toHaveBeenCalledWith(
			expect.objectContaining({ dimension: "gender", bucketKey: "female" })
		)
	})

	it("offers a way back when the cuts could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useDemographics.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<DemographicsDashboard canViewPii={false} />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
