import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SurveyDashboard } from "./survey-dashboard"

const useSurveys = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useSurveyMetricsQuery: (input: unknown) => useSurveys(input),
}))

const summary = {
	from: "2026-09-01",
	to: "2026-09-30",
	timezone: "Asia/Manila" as const,
	totalResponses: 3,
	overallAverageRating: 4,
	overallNps: {
		promoters: 1,
		passives: 1,
		detractors: 1,
		promoterPercent: 33.33,
		passivePercent: 33.33,
		detractorPercent: 33.33,
		score: 0,
	},
	consent: { granted: 2, withdrawn: 1 },
	storeRatingsAvailable: false,
	surveys: [
		{
			contentItemId: "1f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
			title: "How did we do?",
			promptsShown: 4,
			declined: 1,
			responses: 3,
			completionRatePercent: 75,
			averageRating: 4,
			consent: { granted: 2, withdrawn: 1 },
			questions: [
				{
					questionId: "2f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d62",
					position: 0,
					kind: "rating" as const,
					prompt: "How clear was this topic?",
					required: true,
					answered: 3,
					skipped: 0,
					average: 4,
					distribution: [
						{ value: 1, responses: 0, percent: 0 },
						{ value: 2, responses: 0, percent: 0 },
						{ value: 3, responses: 1, percent: 33.33 },
						{ value: 4, responses: 1, percent: 33.33 },
						{ value: 5, responses: 1, percent: 33.33 },
					],
					nps: null,
				},
				{
					questionId: "3f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d63",
					position: 1,
					kind: "text" as const,
					prompt: "What would you change?",
					required: false,
					answered: 0,
					skipped: 1,
					average: null,
					distribution: [],
					nps: null,
				},
			],
		},
	],
}

describe("SurveyDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useSurveys.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("shows the headline figures with the pool behind each", () => {
		render(<SurveyDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getAllByText("Responses").length).toBeGreaterThan(0)
		expect(screen.getByText("2 on a standing grant")).toBeInTheDocument()
		expect(screen.getByText("33.33% promoters less 33.33% detractors")).toBeInTheDocument()
		expect(
			screen.getByText("Responses whose grant was later taken back")
		).toBeInTheDocument()
	})

	it("shows every point on a scale, including the ones nobody chose", () => {
		render(<SurveyDashboard from="2026-09-01" to="2026-09-30" />)

		// A missing bar would read as a value that could not be picked.
		expect(screen.getAllByRole("cell", { name: "0 (0%)" })).toHaveLength(2)
		expect(screen.getAllByRole("cell", { name: "1 (33.33%)" })).toHaveLength(3)
	})

	it("says the store ratings are not in these figures", () => {
		render(<SurveyDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getByText("In-app answers only")).toBeInTheDocument()
	})

	it("says nobody answered rather than showing a score of zero", () => {
		useSurveys.mockReturnValue({
			isPending: false,
			isError: false,
			data: {
				...summary,
				overallAverageRating: null,
				overallNps: { ...summary.overallNps, score: null },
			},
			refetch: vi.fn(),
		})

		render(<SurveyDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getAllByText("No answers yet")).toHaveLength(2)
	})

	it("says plainly when no survey was answered in the range", () => {
		useSurveys.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...summary, surveys: [] },
			refetch: vi.fn(),
		})

		render(<SurveyDashboard from="2026-09-01" to="2026-09-30" />)

		expect(screen.getByText("No survey was answered in this range.")).toBeInTheDocument()
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useSurveys.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<SurveyDashboard from="2026-09-01" to="2026-09-30" />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
