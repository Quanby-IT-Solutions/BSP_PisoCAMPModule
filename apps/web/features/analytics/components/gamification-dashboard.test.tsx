import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GamificationDashboard } from "./gamification-dashboard"

const useGamification = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useGamificationSummaryQuery: (input: unknown) => useGamification(input),
}))

const summary = {
	from: "2026-09-01",
	to: "2026-09-30",
	timezone: "Asia/Manila" as const,
	leaderboardEnabled: true,
	participation: {
		eligibleUsers: 5,
		participatingUsers: 4,
		participationRatePercent: 80,
		movedUp: 1,
		movedDown: 1,
		unchanged: 1,
		newEntrants: 1,
	},
	topPerformers: {
		topGroupPercent: 10,
		previousTopUsers: 2,
		retainedTopUsers: 1,
		retentionRatePercent: 50,
	},
	trivia: {
		promptsShown: 4,
		answered: 3,
		skipped: 1,
		correct: 2,
		incorrect: 1,
		completionRatePercent: 75,
		accuracyPercent: 66.67,
		participants: 2,
		repeatParticipants: 1,
		repeatRatePercent: 50,
	},
	reengagement: {
		sessionsWithTrivia: 2,
		sessionsReturningToContent: 1,
		reengagementRatePercent: 50,
		contentViewsAfterTrivia: 1,
		relatedLinkOpensAfterTrivia: 1,
		engagementPromptsAfterTrivia: 2,
	},
}

describe("GamificationDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useGamification.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("shows each rate with the pool it was computed from", () => {
		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getByText("80%")).toBeInTheDocument()
		expect(screen.getByText("4 of 5 registered")).toBeInTheDocument()
		expect(screen.getByText("1 of 2 in the top 10%")).toBeInTheDocument()
		expect(screen.getByText("3 answered of 4 shown")).toBeInTheDocument()
		expect(screen.getByText("1 of 2 trivia sessions")).toBeInTheDocument()
	})

	it("keeps accuracy and completion apart", () => {
		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		// Answered of shown, and right of answered, are different questions.
		expect(screen.getByText("75%")).toBeInTheDocument()
		expect(screen.getByRole("cell", { name: "66.67%" })).toBeInTheDocument()
	})

	it("reports rank movement including the entrants with nothing to compare", () => {
		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getByRole("cell", { name: "New entrants" })).toBeInTheDocument()
		expect(screen.getByRole("cell", { name: "Held station" })).toBeInTheDocument()
	})

	it("says the board is off, so a zero is not read as nobody playing", () => {
		useGamification.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...summary, leaderboardEnabled: false },
			refetch: vi.fn(),
		})

		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getByText("The leaderboard is switched off")).toBeInTheDocument()
	})

	it("stays quiet about the switch when the board is on", () => {
		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.queryByText("The leaderboard is switched off")).not.toBeInTheDocument()
	})

	it("keeps the prompts apart from the return to content", () => {
		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		// Shown, because the criterion names it; out of the rate, because being
		// asked to register is not a return to the learning content.
		expect(
			screen.getByRole("cell", { name: "Engagement prompts after trivia" })
		).toBeInTheDocument()
		expect(screen.getByText("1 of 2 trivia sessions")).toBeInTheDocument()
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useGamification.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<GamificationDashboard from="2026-09-01" to="2026-09-30" />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
