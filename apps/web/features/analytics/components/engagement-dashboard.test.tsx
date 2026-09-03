import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { EngagementDashboard } from "./engagement-dashboard"

const useEngagement = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useEngagementSummaryQuery: (input: unknown) => useEngagement(input),
	useAdoptionSummaryQuery: () => ({ isPending: true, isError: false }),
	useRetentionSummaryQuery: () => ({ isPending: true, isError: false }),
	useGamificationSummaryQuery: () => ({ isPending: true, isError: false }),
	useSurveyMetricsQuery: () => ({ isPending: true, isError: false }),
}))

const summary = {
	from: "2026-08-10",
	to: "2026-08-11",
	timezone: "Asia/Manila" as const,
	sessionInactivityMinutes: 30,
	dau: 1,
	mau: 2,
	dauMauPercent: 50,
	sessions: 4,
	activeUsers: 2,
	sessionsPerUser: 2,
	averageSessionSeconds: 300,
	screenViewsPerSession: 1.25,
	dailyActive: [
		{ date: "2026-08-10", activeUsers: 2 },
		{ date: "2026-08-11", activeUsers: 1 },
	],
	hourly: Array.from({ length: 24 }, (_value, hour) => ({
		hour,
		sessions: hour === 9 ? 2 : 0,
	})),
	peakConcurrency: { intervalStart: "2026-08-10T02:30:00.000Z", sessions: 2 },
}

describe("EngagementDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useEngagement.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("shows every headline figure", () => {
		render(<EngagementDashboard />)

		expect(screen.getByText("DAU")).toBeInTheDocument()
		expect(screen.getByText("50%")).toBeInTheDocument()
		expect(screen.getByText("1.25")).toBeInTheDocument()
		// Seconds are not a duration a reader can use.
		expect(screen.getByText("5m 00s")).toBeInTheDocument()
	})

	it("names the busiest hour and the peak concurrency", () => {
		render(<EngagementDashboard />)

		expect(screen.getByText(/09:00/)).toBeInTheDocument()
		expect(screen.getByText(/Most sessions open at once: 2/)).toBeInTheDocument()
		expect(
			screen.getByText(/A session gap of 30 minutes ends a session/)
		).toBeInTheDocument()
	})

	it("lists a row for every day in the range", () => {
		render(<EngagementDashboard />)

		expect(screen.getByText("2026-08-10")).toBeInTheDocument()
		expect(screen.getByText("2026-08-11")).toBeInTheDocument()
	})

	it("says plainly when nothing was open in the range", () => {
		useEngagement.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...summary, peakConcurrency: null },
			refetch: vi.fn(),
		})

		render(<EngagementDashboard />)

		expect(screen.getByText("No sessions were open in this range.")).toBeInTheDocument()
	})

	it("asks the server for a new range only when it is a range", async () => {
		const user = userEvent.setup()
		render(<EngagementDashboard />)
		const callsBefore = useEngagement.mock.calls.length

		const from = screen.getByLabelText("From")
		await user.clear(from)
		await user.type(from, "2026-09-30")
		await user.click(screen.getByRole("button", { name: /apply range/i }))

		expect(screen.getByRole("alert")).toHaveTextContent(
			"The range must start on or before it ends."
		)
		// The last call still carries the range that was actually applied.
		const lastInput = useEngagement.mock.calls.at(-1)?.[0] as { from: string }
		expect(lastInput.from).not.toBe("2026-09-30")
		expect(useEngagement.mock.calls.length).toBeGreaterThanOrEqual(callsBefore)
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useEngagement.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<EngagementDashboard />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
