import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TechnicalDashboard } from "./technical-dashboard"

const useTechnical = vi.fn()
const record = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useTechnicalMetricsQuery: (input: unknown) => useTechnical(input),
	useRecordPerformanceTestMutation: () => ({ mutate: record, isPending: false }),
}))

const summary = {
	from: "2026-09-01",
	to: "2026-09-30",
	timezone: "Asia/Manila" as const,
	crashes: {
		source: "sentry",
		crashCount: 12,
		affectedUsers: 7,
		affectedSessions: 10,
		totalSessions: 1000,
		crashesPerSession: 0.012,
		crashFreeSessionRatePercent: 99,
	},
	loadTime: {
		samples: 10,
		p50Ms: 550,
		p95Ms: 3155,
		maxMs: 5000,
		coldSamples: 4,
		warmSamples: 6,
	},
	endpoints: [
		{
			endpoint: "GET /pisocamp/config",
			requestCount: 1000,
			errorCount: 20,
			errorRatePercent: 2,
			timeoutCount: 5,
			authFailureCount: 2,
			latencyP50Ms: 40,
			latencyP95Ms: 180,
		},
	],
	networkFailures: [
		{ failureType: "timeout" as const, count: 2 },
		{ failureType: "no_connectivity" as const, count: 1 },
		{ failureType: "sync_failed" as const, count: 0 },
		{ failureType: "download_failed" as const, count: 0 },
		{ failureType: "report_failed" as const, count: 0 },
		{ failureType: "upload_failed" as const, count: 0 },
	],
	networkFailureTotal: 3,
	performanceTests: [
		{
			id: "1f1d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
			testedAt: "2026-09-05",
			appVersion: "1.2.0+8",
			platform: "android" as const,
			deviceModel: "Pixel 7a",
			appSizeMb: 84.5,
			moduleSizeIncreaseMb: 12.25,
			downloadedAssetsMb: 30,
			localStorageMb: 45.75,
			batteryImpactPercent: 3.5,
			notes: null,
			recordedBy: "admin",
			recordedAt: "2026-09-05T02:00:00.000Z",
		},
	],
}

describe("TechnicalDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useTechnical.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("shows the crash figures with the pool behind them", () => {
		render(<TechnicalDashboard canRecord={false} />)

		expect(screen.getByText("99%")).toBeInTheDocument()
		expect(screen.getByText("10 of 1,000 sessions crashed")).toBeInTheDocument()
		expect(screen.getByText("From sentry")).toBeInTheDocument()
	})

	it("says nothing was imported rather than showing a crash-free 0%", () => {
		useTechnical.mockReturnValue({
			isPending: false,
			isError: false,
			data: { ...summary, crashes: null },
			refetch: vi.fn(),
		})

		render(<TechnicalDashboard canRecord={false} />)

		expect(
			screen.getByText(/Nothing has been imported for this range/)
		).toBeInTheDocument()
	})

	it("shows the load-time percentiles and the endpoint table", () => {
		render(<TechnicalDashboard canRecord={false} />)

		expect(screen.getByText("550 ms")).toBeInTheDocument()
		expect(screen.getByText("3,155 ms")).toBeInTheDocument()
		expect(screen.getByRole("cell", { name: "GET /pisocamp/config" })).toBeInTheDocument()
		expect(screen.getByRole("cell", { name: "20 (2%)" })).toBeInTheDocument()
	})

	it("names every kind of network failure, including the quiet ones", () => {
		render(<TechnicalDashboard canRecord={false} />)

		expect(screen.getByRole("cell", { name: "No connectivity" })).toBeInTheDocument()
		// A missing row would read as a failure that cannot happen.
		expect(screen.getByRole("cell", { name: "Upload failed" })).toBeInTheDocument()
	})

	it("offers the entry form only to somebody who may save one", () => {
		render(<TechnicalDashboard canRecord={false} />)

		expect(screen.queryByRole("button", { name: /record run/i })).not.toBeInTheDocument()
	})

	it("records a run from the form", async () => {
		const user = userEvent.setup()
		render(<TechnicalDashboard canRecord />)

		await user.type(screen.getByLabelText("Tested on"), "2026-09-06")
		await user.type(screen.getByLabelText("App version"), "1.2.1+9")
		await user.type(screen.getByLabelText("Device"), "Pixel 8")
		await user.type(screen.getByLabelText("App size (MB)"), "85")
		await user.type(screen.getByLabelText("Module increase (MB)"), "12")
		await user.type(screen.getByLabelText("Downloaded assets (MB)"), "30")
		await user.type(screen.getByLabelText("Local storage (MB)"), "40")
		await user.type(screen.getByLabelText("Battery impact (%)"), "4")
		await user.click(screen.getByRole("button", { name: /record run/i }))

		expect(record).toHaveBeenCalledTimes(1)
		expect(record.mock.calls[0]?.[0]).toMatchObject({
			testedAt: "2026-09-06",
			appVersion: "1.2.1+9",
			platform: "android",
			deviceModel: "Pixel 8",
			appSizeMb: 85,
			batteryImpactPercent: 4,
			notes: null,
		})
	})

	it("refuses a battery impact above a full charge", async () => {
		const user = userEvent.setup()
		render(<TechnicalDashboard canRecord />)

		await user.type(screen.getByLabelText("Tested on"), "2026-09-06")
		await user.type(screen.getByLabelText("App version"), "1.2.1+9")
		await user.type(screen.getByLabelText("Device"), "Pixel 8")
		await user.type(screen.getByLabelText("App size (MB)"), "85")
		await user.type(screen.getByLabelText("Module increase (MB)"), "12")
		await user.type(screen.getByLabelText("Downloaded assets (MB)"), "30")
		await user.type(screen.getByLabelText("Local storage (MB)"), "40")
		await user.type(screen.getByLabelText("Battery impact (%)"), "140")
		await user.click(screen.getByRole("button", { name: /record run/i }))

		expect(record).not.toHaveBeenCalled()
		expect(screen.getByRole("alert")).toHaveTextContent(/cannot pass 100%/)
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useTechnical.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<TechnicalDashboard canRecord={false} />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
