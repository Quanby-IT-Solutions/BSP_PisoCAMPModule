import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AcquisitionDashboard, parseStoreCsv } from "./acquisition-dashboard"

const useAcquisition = vi.fn()
const importRows = vi.fn()

vi.mock("@/features/analytics/api/analytics.hooks", () => ({
	useAcquisitionSummaryQuery: (input: unknown) => useAcquisition(input),
	useImportStoreMetricsMutation: () => ({ mutate: importRows, isPending: false }),
}))

const summary = {
	from: "2026-09-01",
	to: "2026-09-30",
	timezone: "Asia/Manila" as const,
	installVolume: {
		firstOpenDevices: 800,
		storeInstalls: 1200,
		storeUninstalls: 40,
		headlineSource: "store" as const,
		headlineInstalls: 1200,
		sourceLabel: "Store reports (Google Play)",
	},
	stores: [
		{
			source: "google_play" as const,
			installs: 1200,
			uninstalls: 40,
			ratingAverage: 4.4,
			ratingCount: 100,
			periods: 2,
		},
	],
	ratings: {
		inAppAverage: 4,
		inAppResponses: 2,
		storeAverage: 4.4,
		storeRatings: 100,
		combinedAverage: 4.39,
		combinedRatings: 102,
	},
	storeDataAvailable: true,
}

describe("parseStoreCsv", () => {
	const header = "source,periodStart,periodEnd,installs,uninstalls,ratingAverage,ratingCount"

	it("parses a store export into rows", () => {
		const parsed = parseStoreCsv(
			`${header}\ngoogle_play,2026-09-01,2026-09-07,1200,40,4.4,100`
		)

		expect(parsed.error).toBeNull()
		expect(parsed.rows).toEqual([
			{
				source: "google_play",
				periodStart: "2026-09-01",
				periodEnd: "2026-09-07",
				installs: 1200,
				uninstalls: 40,
				ratingAverage: 4.4,
				ratingCount: 100,
			},
		])
	})

	it("treats an empty rating column as no rating, not a zero", () => {
		const parsed = parseStoreCsv(`${header}\napp_store,2026-09-01,2026-09-07,300,5,,`)

		expect(parsed.rows[0]).toMatchObject({ ratingAverage: null, ratingCount: null })
	})

	it("refuses a file whose header is not the expected one", () => {
		const parsed = parseStoreCsv("installs,ratings\n1,2")

		// A silent mis-parse would put a wrong install count in front of
		// somebody as though the store had said it.
		expect(parsed.rows).toEqual([])
		expect(parsed.error).toContain("The first line must be exactly")
	})

	it("names the line that is wrong", () => {
		const parsed = parseStoreCsv(`${header}\ngoogle_play,2026-09-01,2026-09-07,many,40,4.4,100`)

		expect(parsed.error).toBe("Line 2 has a value that is not a number.")
	})

	it("refuses an unknown store", () => {
		const parsed = parseStoreCsv(`${header}\nsideload,2026-09-01,2026-09-07,1,0,,`)

		expect(parsed.error).toContain("unknown store")
	})
})

describe("AcquisitionDashboard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAcquisition.mockReturnValue({
			isPending: false,
			isError: false,
			data: summary,
			refetch: vi.fn(),
		})
	})

	it("names the source of the install figure", () => {
		render(<AcquisitionDashboard canImport={false} />)

		expect(screen.getAllByText("Store reports (Google Play)").length).toBeGreaterThan(0)
		// Once as the headline and once in the per-store table.
		expect(screen.getAllByText("1,200")).toHaveLength(2)
		expect(screen.getByText("800")).toBeInTheDocument()
	})

	it("says plainly that the two counts are not added together", () => {
		render(<AcquisitionDashboard canImport={false} />)

		expect(screen.getByText("The two counts are not added together")).toBeInTheDocument()
		// 1200 + 800 would be the double count the ticket asks to avoid.
		expect(screen.queryByText("2,000")).not.toBeInTheDocument()
	})

	it("shows the in-app, store and combined ratings", () => {
		render(<AcquisitionDashboard canImport={false} />)

		expect(screen.getByText("In-app")).toBeInTheDocument()
		expect(screen.getByText("4.39")).toBeInTheDocument()
		expect(screen.getByText("102 ratings in total")).toBeInTheDocument()
	})

	it("offers the import only to somebody who may run it", () => {
		render(<AcquisitionDashboard canImport={false} />)

		expect(screen.queryByRole("button", { name: /import report/i })).not.toBeInTheDocument()
	})

	it("imports pasted rows", async () => {
		const user = userEvent.setup()
		render(<AcquisitionDashboard canImport />)

		await user.type(
			screen.getByLabelText("Or paste the rows"),
			"source,periodStart,periodEnd,installs,uninstalls,ratingAverage,ratingCount{Enter}google_play,2026-09-01,2026-09-07,1200,40,4.4,100"
		)
		await user.click(screen.getByRole("button", { name: /import report/i }))

		expect(importRows).toHaveBeenCalledTimes(1)
		expect(importRows.mock.calls[0]?.[0]).toEqual({
			rows: [
				{
					source: "google_play",
					periodStart: "2026-09-01",
					periodEnd: "2026-09-07",
					installs: 1200,
					uninstalls: 40,
					ratingAverage: 4.4,
					ratingCount: 100,
				},
			],
		})
	})

	it("refuses a malformed paste before sending anything", async () => {
		const user = userEvent.setup()
		render(<AcquisitionDashboard canImport />)

		await user.type(screen.getByLabelText("Or paste the rows"), "installs{Enter}5")
		await user.click(screen.getByRole("button", { name: /import report/i }))

		expect(importRows).not.toHaveBeenCalled()
		expect(document.querySelector("#store-import-error")).toHaveTextContent(
			/first line must be exactly/
		)
	})

	it("offers a way back when the figures could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useAcquisition.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<AcquisitionDashboard canImport={false} />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
