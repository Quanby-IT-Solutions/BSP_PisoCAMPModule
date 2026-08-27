import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContentReviewQueueView } from "./content-review-queue-view"

const { useReviewQueue, replace } = vi.hoisted(() => ({
	useReviewQueue: vi.fn(),
	replace: vi.fn(),
}))
let searchParams = new URLSearchParams()

vi.mock("@/features/pisocamp-content-admin/api/content.hooks", () => ({
	usePisoCampContentReviewQueueQuery: (input: unknown) => useReviewQueue(input),
}))
vi.mock("next/navigation", () => ({
	usePathname: () => "/pisocamp/content/review",
	useRouter: () => ({ replace }),
	useSearchParams: () => searchParams,
}))

const item = {
	id: "38fd44f4-ebde-49b1-86e0-b6711ccf6756",
	contentType: "advisory",
	status: "submitted_for_review",
	title: "Counterfeit currency advisory",
	currentVersionNo: 4,
	creator: { id: "creator", name: "Maria Creator" },
	lastEditor: { id: "editor", name: "Elena Editor" },
	createdAt: "2026-08-25T08:00:00.000Z",
	dateModified: "2026-08-26T08:00:00.000Z",
}

describe("ContentReviewQueueView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		searchParams = new URLSearchParams()
		replace.mockImplementation((url: string) => {
			searchParams = new URLSearchParams(url.split("?")[1] ?? "")
		})
		useReviewQueue.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [item], page: 1, limit: 20, total: 1 },
			refetch: vi.fn(),
		})
	})

	it("renders accessible loading, error/retry, and empty states", async () => {
		const user = userEvent.setup()
		useReviewQueue.mockReturnValueOnce({ isPending: true, isError: false, data: undefined })
		const { rerender } = render(<ContentReviewQueueView canReview />)
		expect(screen.getByRole("status", { name: /loading review queue/i })).toBeInTheDocument()

		const refetch = vi.fn()
		useReviewQueue.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		rerender(<ContentReviewQueueView canReview />)
		expect(screen.getByText("Could Not Load the Review Queue")).toBeInTheDocument()
		const retry = screen.getByRole("button", { name: /try again/i })
		await user.click(retry)
		expect(refetch).toHaveBeenCalledOnce()
		expect(retry).toHaveClass("min-h-11")

		useReviewQueue.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [], page: 1, limit: 20, total: 0 },
			refetch,
		})
		rerender(<ContentReviewQueueView canReview />)
		expect(screen.getByRole("heading", { name: "Review Queue Is Empty" })).toBeInTheDocument()
	})

	it("keeps an empty deep-linked page recoverable when the queue still has results", async () => {
		searchParams = new URLSearchParams("page=2")
		useReviewQueue.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [], page: 2, limit: 20, total: 45 },
			refetch: vi.fn(),
		})
		const user = userEvent.setup()
		const { rerender } = render(<ContentReviewQueueView canReview />)

		expect(screen.getByText(/no review items on page 2/i)).toBeInTheDocument()
		expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument()
		const previous = screen.getByRole("button", { name: /previous page/i })
		expect(previous).toBeEnabled()
		await user.click(previous)
		rerender(<ContentReviewQueueView canReview />)
		expect(replace).toHaveBeenLastCalledWith("/pisocamp/content/review")
		expect(useReviewQueue).toHaveBeenLastCalledWith({ page: 1, limit: 20 })
	})

	it("retains Previous when a deep-linked page exceeds the only available page", async () => {
		searchParams = new URLSearchParams("page=2")
		useReviewQueue.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [], page: 2, limit: 20, total: 1 },
			refetch: vi.fn(),
		})
		const user = userEvent.setup()
		const { rerender } = render(<ContentReviewQueueView canReview />)

		expect(screen.getByText(/no review items on page 2/i)).toBeInTheDocument()
		expect(screen.getByText(/page 2 of 1/i)).toBeInTheDocument()
		const previous = screen.getByRole("button", { name: /previous page/i })
		expect(previous).toBeEnabled()
		await user.click(previous)
		rerender(<ContentReviewQueueView canReview />)
		expect(replace).toHaveBeenLastCalledWith("/pisocamp/content/review")
		expect(useReviewQueue).toHaveBeenLastCalledWith({ page: 1, limit: 20 })
	})

	it("shows complete responsive queue metadata with visible status and Manila time", () => {
		render(<ContentReviewQueueView canReview />)

		expect(screen.getAllByText(item.title).length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText("Submitted for review").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText("Maria Creator").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText("Elena Editor").length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText(/Aug 26, 2026/i).length).toBeGreaterThanOrEqual(2)
		expect(screen.getAllByText(/Asia\/Manila/i).length).toBeGreaterThanOrEqual(2)
		expect(screen.getByTestId("content-review-queue-layout")).toHaveClass(
			"w-full",
			"max-w-full",
			"min-w-0"
		)
		expect(screen.getByTestId("review-queue-cards")).toHaveClass("md:hidden")
		expect(screen.getByTestId("review-queue-table")).toHaveClass("hidden", "md:block")
		for (const link of screen.getAllByRole("link", { name: /review counterfeit currency/i })) {
			expect(link).toHaveAttribute("href", `/pisocamp/content/review/${item.id}`)
			expect(link).toHaveClass("min-h-11", "transition-colors", "touch-manipulation")
			expect(link).not.toHaveClass("transition-all")
		}
	})

	it("breaks legally long actor names in the mobile queue card", () => {
		const legalName = "A".repeat(220)
		useReviewQueue.mockReturnValue({
			isPending: false,
			isError: false,
			data: {
				items: [{ ...item, creator: { id: "creator", name: legalName } }],
				page: 1,
				limit: 20,
				total: 1,
			},
			refetch: vi.fn(),
		})
		render(<ContentReviewQueueView canReview />)

		const mobileName = screen.getAllByText(legalName)[0]
		expect(mobileName?.closest("p")).toHaveClass("min-w-0", "break-words")
	})

	it("makes every queue page reachable with keyboard-operable controls", async () => {
		const user = userEvent.setup()
		useReviewQueue.mockReturnValue({
			isPending: false,
			isError: false,
			data: { items: [item], page: 1, limit: 20, total: 45 },
			refetch: vi.fn(),
		})
		const { rerender } = render(<ContentReviewQueueView canReview />)

		expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument()
		const next = screen.getByRole("button", { name: /next page/i })
		next.focus()
		await user.keyboard("{Enter}")
		rerender(<ContentReviewQueueView canReview />)
		await waitFor(() => expect(useReviewQueue).toHaveBeenLastCalledWith({ page: 2, limit: 20 }))
		expect(replace).toHaveBeenLastCalledWith("/pisocamp/content/review?page=2")
		expect(next).toHaveClass("min-h-11")
	})
})
