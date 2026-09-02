import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AdoptionDashboard } from "./adoption-dashboard"

const useAdoption = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useAdoptionSummaryQuery: (input: unknown) => useAdoption(input),
}))

const FEATURES = [
	"currency_education",
	"banknotes",
	"coins",
	"3d_coin",
	"haptic",
	"tilt",
	"zoom_pan",
	"trivia",
	"leaderboard",
	"ar",
	"recognition",
	"survey",
	"advisory",
	"external_link",
	"internal_link",
] as const

const summary = {
	from: "2026-08-10",
	to: "2026-08-11",
	timezone: "Asia/Manila" as const,
	keyActionEvents: ["content_view", "feature_use"] as const,
	promptedUsers: 3,
	registeredUsers: 1,
	accountCreationRatePercent: 33.33,
	timeToFirstKeyActionMedianSeconds: 1800,
	timeToFirstKeyActionP95Seconds: 5400,
	firstDayActivatedUsers: 2,
	enteredUsers: 3,
	firstDayActivationRatePercent: 66.67,
	features: FEATURES.map(feature => ({
		feature,
		uses: feature === "banknotes" ? 2 : 0,
		users: feature === "banknotes" ? 2 : 0,
	})),
}

describe("AdoptionDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAdoption.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("shows the onboarding rates with what they were computed from", () => {
		render(<AdoptionDashboard from="2026-08-10" to="2026-08-11" />)

		expect(screen.getByText("33.33%")).toBeInTheDocument()
		expect(screen.getByText("1 of 3 prompted")).toBeInTheDocument()
		expect(screen.getByText("66.67%")).toBeInTheDocument()
		expect(screen.getByText("2 of 3 who entered")).toBeInTheDocument()
	})

	it("shows the timings as durations rather than seconds", () => {
		render(<AdoptionDashboard from="2026-08-10" to="2026-08-11" />)

		expect(screen.getByText("30m 00s")).toBeInTheDocument()
		expect(screen.getByText("1h 30m")).toBeInTheDocument()
	})

	it("says plainly when nobody has taken a key action", () => {
		useAdoption.mockReturnValue({
			isPending: false,
			isError: false,
			data: {
				...summary,
				timeToFirstKeyActionMedianSeconds: null,
				timeToFirstKeyActionP95Seconds: null,
			},
			refetch: vi.fn(),
		})

		render(<AdoptionDashboard from="2026-08-10" to="2026-08-11" />)

		// Null is "nobody acted", not "acted instantly", and the screen says so.
		expect(screen.getAllByText("No key action yet")).toHaveLength(2)
	})

	it("lists every AN-013 feature, including the ones with no uses", () => {
		render(<AdoptionDashboard from="2026-08-10" to="2026-08-11" />)

		expect(screen.getByText("Banknotes")).toBeInTheDocument()
		expect(screen.getByText("Leaderboard")).toBeInTheDocument()
		expect(screen.getByText("AR")).toBeInTheDocument()
		expect(screen.getByText("Recognition")).toBeInTheDocument()
		expect(screen.getByText(/A feature with no uses may not be built yet/)).toBeInTheDocument()
	})

	it("names the key actions it counted", () => {
		render(<AdoptionDashboard from="2026-08-10" to="2026-08-11" />)

		expect(screen.getByText(/content_view, feature_use/)).toBeInTheDocument()
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useAdoption.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<AdoptionDashboard from="2026-08-10" to="2026-08-11" />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
