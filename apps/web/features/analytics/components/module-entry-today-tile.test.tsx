import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ModuleEntryTodayTile } from "./module-entry-today-tile"

const { isQueryLoading, refetch, useModuleEntryTodayQuery } = vi.hoisted(() => ({
	isQueryLoading: vi.fn(),
	refetch: vi.fn(),
	useModuleEntryTodayQuery: vi.fn(),
}))

vi.mock("@/features/analytics/api/analytics.hooks", () => ({ useModuleEntryTodayQuery }))
vi.mock("@/services/tanstack-query/use-query-loading", () => ({
	useIsQueryLoading: () => isQueryLoading,
}))

describe("ModuleEntryTodayTile", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		isQueryLoading.mockImplementation(query => query.isLoading)
		useModuleEntryTodayQuery.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: true,
			isFetching: true,
			refetch,
		})
	})

	it("keeps the loading card during persisted-query restoration", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: false,
			isPending: true,
			refetch,
		})
		isQueryLoading.mockReturnValue(true)

		render(<ModuleEntryTodayTile />)

		expect(screen.getByRole("status")).toHaveTextContent(/loading module entries/i)
		expect(isQueryLoading).toHaveBeenCalledWith(
			expect.objectContaining({ isLoading: false, isPending: true })
		)
	})

	it("keeps its stable title and announces loading status", () => {
		render(<ModuleEntryTodayTile />)

		const tile = screen.getByRole("region", { name: "Module entries today" })
		expect(tile).toBeVisible()
		expect(screen.getByRole("heading", { name: "Module entries today" })).toBeVisible()
		expect(screen.getByRole("status")).toHaveTextContent(/loading module entries/i)
		expect(useModuleEntryTodayQuery).toHaveBeenCalledWith({ enabled: true })
	})

	it("announces an actionable offline state without fabricating a count or date", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: undefined,
			fetchStatus: "paused",
			isError: false,
			isFetching: false,
			isLoading: false,
			isPending: true,
			status: "pending",
			refetch,
		})

		render(<ModuleEntryTodayTile />)

		expect(screen.getByRole("status")).toHaveTextContent(
			/module entries are unavailable while offline\. reconnect to try again\./i
		)
		expect(screen.queryByLabelText(/^\d[\d,]* module entries today$/i)).not.toBeInTheDocument()
		expect(screen.queryByRole("time")).not.toBeInTheDocument()
	})

	it("keeps cached aggregate data visible while an offline refresh is paused", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: { moduleEntryCount: 8, date: "2026-08-31", timezone: "Asia/Manila" },
			fetchStatus: "paused",
			isError: false,
			isFetching: false,
			isLoading: false,
			isPending: false,
			status: "success",
			refetch,
		})

		render(<ModuleEntryTodayTile />)

		expect(screen.getByLabelText("8 module entries today")).toBeVisible()
		expect(screen.getByRole("time")).toHaveAttribute("datetime", "2026-08-31")
	})

	it("renders a numeric zero instead of an empty state", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: { moduleEntryCount: 0, date: "2026-08-31", timezone: "Asia/Manila" },
			isError: false,
			isLoading: false,
			isFetching: false,
			refetch,
		})

		render(<ModuleEntryTodayTile />)

		expect(screen.getByLabelText("0 module entries today")).toHaveTextContent("0")
	})

	it("renders a localized count with the server date and Manila timezone", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: { moduleEntryCount: 12_345, date: "2026-08-31", timezone: "Asia/Manila" },
			isError: false,
			isLoading: false,
			isFetching: false,
			refetch,
		})

		render(<ModuleEntryTodayTile />)

		const value = screen.getByLabelText("12,345 module entries today")
		expect(value).toHaveTextContent("12,345")
		expect(value).toHaveAttribute("aria-live", "polite")
		const date = screen.getByText("Aug 31, 2026 · Asia/Manila")
		expect(date).toBeVisible()
		expect(date).toHaveAttribute("datetime", "2026-08-31")
	})

	it("contains failures, offers retry, and never exposes raw error details", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: undefined,
			error: new Error(
				"response body eventId=private pseudonym=private sessionId=private properties=private"
			),
			isError: true,
			isLoading: false,
			isFetching: false,
			refetch,
		})

		render(<ModuleEntryTodayTile />)

		expect(screen.getByRole("alert")).toHaveTextContent(/could not load module entries/i)
		expect(
			screen.queryByText(/eventId|pseudonym|sessionId|properties|response body/i)
		).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /retry module entries/i }))
		expect(refetch).toHaveBeenCalledOnce()
	})

	it("keeps semantic relationships and reflow-safe card structure", () => {
		useModuleEntryTodayQuery.mockReturnValue({
			data: { moduleEntryCount: 7, date: "2026-08-31", timezone: "Asia/Manila" },
			isError: false,
			isLoading: false,
			isFetching: false,
			refetch,
		})

		render(<ModuleEntryTodayTile />)

		const tile = screen.getByRole("region", { name: "Module entries today" })
		const heading = screen.getByRole("heading", { name: "Module entries today" })
		expect(tile).toHaveAttribute("aria-labelledby", heading.id)
		expect(tile).toHaveClass("w-full", "min-w-0")
		expect(heading).toHaveClass("break-words")
	})
})
