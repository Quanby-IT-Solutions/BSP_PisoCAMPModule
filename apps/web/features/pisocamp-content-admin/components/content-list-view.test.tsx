import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContentListView } from "./content-list-view"

const { useContentList, replace } = vi.hoisted(() => ({
	useContentList: vi.fn(),
	replace: vi.fn(),
}))
let searchParams = new URLSearchParams()

vi.mock("@/features/pisocamp-content-admin/api/content.hooks", () => ({
	usePisoCampContentListQuery: (input: unknown) => useContentList(input),
}))
vi.mock("next/navigation", () => ({
	usePathname: () => "/pisocamp/content",
	useRouter: () => ({ replace }),
	useSearchParams: () => searchParams,
}))

const item = {
	id: "38fd44f4-ebde-49b1-86e0-b6711ccf6756",
	contentType: "banknote",
	status: "draft",
	title: "PHP 100 banknote",
	currentVersionNo: 2,
	seriesCode: "ngc-banknotes",
	denominationCode: "php-100",
	creator: { id: "creator-1", name: "Maria Creator" },
	lastEditor: { id: "editor-1", name: "Elena Editor" },
	createdAt: "2026-08-24T00:00:00.000Z",
	dateModified: "2026-08-25T00:00:00.000Z",
}

describe("ContentListView", () => {
	beforeEach(() => {
		searchParams = new URLSearchParams()
		replace.mockReset()
		replace.mockImplementation((url: string) => {
			searchParams = new URLSearchParams(url.split("?")[1] ?? "")
		})
		useContentList.mockReset()
		useContentList.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [item], page: 1, limit: 20, total: 1 },
			refetch: vi.fn(),
		})
	})

	async function chooseSelect(
		user: ReturnType<typeof userEvent.setup>,
		name: RegExp,
		option: string
	) {
		const trigger = screen.getByRole("combobox", { name })
		expect(trigger).toHaveAttribute("data-slot", "select-trigger")
		await user.click(trigger)
		await user.click(await screen.findByRole("option", { name: option }))
	}

	it("shows an accessible loading skeleton", () => {
		useContentList.mockReturnValue({ isPending: true, isError: false, data: undefined })
		render(<ContentListView />)
		expect(screen.getByRole("status", { name: "Loading content…" })).toBeInTheDocument()
	})

	it("shows a retryable load error", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useContentList.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		render(<ContentListView />)
		await user.click(screen.getByRole("button", { name: /try again/i }))
		expect(screen.getByRole("alert")).toHaveTextContent(/could not load content/i)
		expect(refetch).toHaveBeenCalledTimes(1)
	})

	it("renders an empty state and sends filters to the online query", async () => {
		const user = userEvent.setup()
		useContentList.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [], page: 1, limit: 20, total: 0 },
			refetch: vi.fn(),
		})
		const { rerender } = render(<ContentListView />)
		expect(screen.getByText(/no content items found/i)).toBeInTheDocument()

		await chooseSelect(user, /content type/i, "Coin")
		rerender(<ContentListView />)
		expect(useContentList).toHaveBeenLastCalledWith(
			expect.objectContaining({ page: 1, limit: 20, contentType: "coin" })
		)
		expect(replace).toHaveBeenCalledWith("/pisocamp/content?contentType=coin")
	})

	it("restores URL filters and submits search with Enter without querying on every keystroke", async () => {
		searchParams = new URLSearchParams("status=draft&search=polymer&page=2")
		const user = userEvent.setup()
		const { rerender } = render(<ContentListView />)

		expect(useContentList).toHaveBeenLastCalledWith(
			expect.objectContaining({ page: 2, status: "draft", search: "polymer" })
		)
		const callsBeforeTyping = useContentList.mock.calls.length
		const search = screen.getByRole("searchbox", { name: /search/i })
		expect(screen.getByRole("search")).toContainElement(search)
		await user.clear(search)
		await user.type(search, "coin")
		expect(useContentList).toHaveBeenCalledTimes(callsBeforeTyping)
		await user.keyboard("{Enter}")
		rerender(<ContentListView />)
		await waitFor(() =>
			expect(useContentList).toHaveBeenLastCalledWith(
				expect.objectContaining({ page: 1, status: "draft", search: "coin" })
			)
		)
		expect(replace).toHaveBeenLastCalledWith("/pisocamp/content?status=draft&search=coin")
	})

	it("makes every page of a paginated result reachable", async () => {
		const user = userEvent.setup()
		useContentList.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [item], page: 1, limit: 20, total: 45 },
			refetch: vi.fn(),
		})
		const { rerender } = render(<ContentListView />)

		expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /next page/i }))
		rerender(<ContentListView />)
		expect(useContentList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
		expect(replace).toHaveBeenLastCalledWith("/pisocamp/content?page=2")
	})

	it("shows populated creator/editor/date/status details in responsive table and cards", () => {
		render(<ContentListView />)
		expect(screen.getAllByText("PHP 100 banknote").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText("Maria Creator").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText("Elena Editor").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText("Draft").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText(/Aug 25, 2026/i).length).toBeGreaterThanOrEqual(2)
		expect(screen.getByTestId("content-list-layout")).toHaveClass("min-w-0", "max-w-full")
		expect(screen.getByTestId("content-list-layout")).not.toHaveClass(
			"overflow-x-hidden",
			"overflow-hidden"
		)
		const pageHeading = screen.getByRole("heading", { level: 1, name: "Piso CAMP Content" })
		expect(pageHeading).toHaveClass("whitespace-normal", "break-words", "text-pretty")
		expect(pageHeading).not.toHaveClass("truncate")
		expect(screen.getByRole("heading", { level: 2, name: "PHP 100 banknote" })).toBeInTheDocument()
		expect(screen.getByTestId("content-cards")).toHaveClass("md:hidden")
		expect(screen.getByTestId("content-table")).toHaveClass("hidden", "md:block")
		expect(screen.getAllByRole("link", { name: /edit php 100 banknote/i })[0]).toHaveAttribute(
			"href",
			`/pisocamp/content/${item.id}/edit`
		)
	})
})
