import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReportBuilderView } from "./report-builder-view"

const useDefinitions = vi.fn()
const useRuns = vi.fn()
const useGenerate = vi.fn()

vi.mock("@/features/reports/api/reports.hooks", () => ({
	useReportDefinitionsQuery: () => useDefinitions(),
	useReportRunsQuery: () => useRuns(),
	useGenerateReportMutation: () => useGenerate(),
}))

const definitions = [
	{
		key: "activity",
		name: "Activity",
		description: "Event volume by name and by day.",
		dataSource: "analytics_event",
		filters: ["appVersion", "os", "activityType"],
	},
	{
		key: "engagement",
		name: "Engagement",
		description: "Sessions and active users.",
		dataSource: "analytics_session",
		filters: [],
	},
]

const run = {
	id: "6f6e3f1e-6c5a-4a1f-9d4a-4b9f4f7f4d21",
	definitionKey: "activity" as const,
	definitionName: "Activity",
	dataSource: "analytics_event",
	generatedAt: "2026-08-12T02:00:00.000Z",
	generatedBy: "user-1",
	from: "2026-08-10",
	to: "2026-08-11",
	timezone: "Asia/Manila" as const,
	filters: { os: "android" as const },
	suppressed: false,
	suppressionReason: null,
	result: {
		definitionKey: "activity" as const,
		activity: {
			from: "2026-08-10",
			to: "2026-08-11",
			timezone: "Asia/Manila" as const,
			totalEvents: 3,
			distinctUsers: 2,
			byEvent: [{ eventName: "module_entry", events: 3, users: 2 }],
			byDay: [{ date: "2026-08-10", events: 3 }],
		},
	},
}

describe("ReportBuilderView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useDefinitions.mockReturnValue({
			isPending: false,
			isError: false,
			data: { definitions },
			refetch: vi.fn(),
		})
		useRuns.mockReturnValue({ isPending: false, isError: false, data: { runs: [] } })
		useGenerate.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
	})

	it("offers every registered report and says where its figures come from", () => {
		render(<ReportBuilderView />)

		expect(screen.getByRole("option", { name: "Activity" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "Engagement" })).toBeInTheDocument()
		expect(screen.getByText(/Source: analytics_event/)).toBeInTheDocument()
	})

	it("offers only the filters the chosen report can apply", async () => {
		const user = userEvent.setup()
		render(<ReportBuilderView />)

		expect(screen.getByLabelText("App version")).toBeInTheDocument()
		expect(screen.getByLabelText("OS")).toBeInTheDocument()
		// Activity does not support Feature-free reports differently; Engagement
		// supports no filters at all, and offering one would promise a narrowing
		// the server would refuse.
		await user.selectOptions(screen.getByLabelText("Report"), "engagement")

		expect(screen.queryByLabelText("App version")).not.toBeInTheDocument()
		expect(screen.getByText("This report takes a period only.")).toBeInTheDocument()
	})

	it("sends the period and only the filters that were filled in", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useGenerate.mockReturnValue({
			mutate,
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
		render(<ReportBuilderView />)

		await user.type(screen.getByLabelText("OS"), "android")
		await user.click(screen.getByRole("button", { name: /generate report/i }))

		expect(mutate).toHaveBeenCalledTimes(1)
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			definitionKey: "activity",
			filters: { os: "android" },
		})
		// An empty box is not a filter of the empty string.
		expect(mutate.mock.calls[0]?.[0].filters).not.toHaveProperty("appVersion")
	})

	it("refuses a range that ends before it starts, and says so", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useGenerate.mockReturnValue({
			mutate,
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
		render(<ReportBuilderView />)

		const from = screen.getByLabelText("From")
		await user.clear(from)
		await user.type(from, "2026-12-31")
		await user.click(screen.getByRole("button", { name: /generate report/i }))

		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The range must start on or before it ends."
		)
	})

	it("shows the generated report with what produced it", () => {
		useGenerate.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: run,
		})
		render(<ReportBuilderView />)

		expect(screen.getByText(/Generated 2026-08-12T02:00:00.000Z/)).toBeInTheDocument()
		expect(screen.getByText(/covering 2026-08-10 to 2026-08-11/)).toBeInTheDocument()
		expect(screen.getByText(/os = android/)).toBeInTheDocument()
		expect(screen.getByText(/"totalEvents": 3/)).toBeInTheDocument()
	})

	it("says a withheld report was withheld, and why", () => {
		useGenerate.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: {
				...run,
				suppressed: true,
				suppressionReason: "Demographic filters wait for AN-10.",
				result: null,
			},
		})
		render(<ReportBuilderView />)

		expect(screen.getByText("Figures withheld")).toBeInTheDocument()
		expect(screen.getByText("Demographic filters wait for AN-10.")).toBeInTheDocument()
	})

	it("shows the server's reason when generation is refused", () => {
		useGenerate.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: true,
			error: new Error("Engagement cannot filter by appVersion"),
			data: undefined,
		})
		render(<ReportBuilderView />)

		expect(screen.getByText("Engagement cannot filter by appVersion")).toBeInTheDocument()
	})

	it("lists what has been generated already", () => {
		useRuns.mockReturnValue({
			isPending: false,
			isError: false,
			data: { runs: [run] },
		})
		render(<ReportBuilderView />)

		expect(screen.getByRole("cell", { name: "2026-08-10 to 2026-08-11" })).toBeInTheDocument()
		expect(screen.getByRole("cell", { name: "Complete" })).toBeInTheDocument()
	})

	it("says plainly when nothing has been generated", () => {
		render(<ReportBuilderView />)

		expect(screen.getByText("No report has been run yet.")).toBeInTheDocument()
	})
})
