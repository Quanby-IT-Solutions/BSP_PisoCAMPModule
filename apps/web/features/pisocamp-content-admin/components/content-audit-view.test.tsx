import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContentAuditView } from "./content-audit-view"

const { useAudit } = vi.hoisted(() => ({ useAudit: vi.fn() }))

vi.mock("@/features/pisocamp-content-admin/api/audit.hooks", () => ({
	usePisoCampContentAuditQuery: (input: unknown, enabled: unknown) => useAudit(input, enabled),
}))

const ITEM_ID = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"

const entries = [
	{
		id: 6,
		action: "content.unpublish" as const,
		fromState: "published" as const,
		toState: "unpublished" as const,
		versionNo: 6,
		comments: "Superseded by the new advisory",
		actor: { id: "approver", name: "Sam Rivera" },
		at: "2026-09-01T06:00:00.000Z",
	},
	{
		id: 2,
		action: "content.edit" as const,
		fromState: null,
		toState: null,
		versionNo: 2,
		comments: null,
		actor: { id: "editor", name: "Elena Editor" },
		at: "2026-09-01T02:00:00.000Z",
	},
	{
		id: 1,
		action: "content.create" as const,
		fromState: null,
		toState: null,
		versionNo: 1,
		comments: null,
		actor: null,
		at: "2026-09-01T01:00:00.000Z",
	},
]

function loaded(overrides: Record<string, unknown> = {}) {
	return {
		isPending: false,
		isError: false,
		refetch: vi.fn(),
		data: {
			itemId: ITEM_ID,
			entries,
			actors: [
				{ id: "editor", name: "Elena Editor" },
				{ id: "approver", name: "Sam Rivera" },
			],
			page: 1,
			limit: 25,
			total: 3,
		},
		...overrides,
	}
}

describe("ContentAuditView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAudit.mockReturnValue(loaded())
	})

	it("shows every entry with actor, time, state change and comments", () => {
		render(<ContentAuditView itemId={ITEM_ID} />)

		expect(screen.getByText("3 Recorded Entries")).toBeInTheDocument()
		// Scoped to the list: the action filter repeats every label as an option.
		const list = within(screen.getByRole("list"))
		expect(list.getByText("Unpublished")).toBeInTheDocument()
		expect(list.getByText("Published → Unpublished")).toBeInTheDocument()
		expect(list.getByText("Superseded by the new advisory")).toBeInTheDocument()
		expect(list.getByText("Sam Rivera")).toBeInTheDocument()
		expect(list.getByText("Edited")).toBeInTheDocument()
		expect(list.getByText("Created")).toBeInTheDocument()
		// An entry whose account is gone still reads as evidence.
		expect(list.getByText("Removed account")).toBeInTheDocument()
	})

	it("requests the item scoped, unfiltered history first", () => {
		render(<ContentAuditView itemId={ITEM_ID} />)

		expect(useAudit).toHaveBeenCalledWith({ itemId: ITEM_ID, page: 1, limit: 25 }, true)
	})

	it("narrows by actor and by action, resetting to the first page", async () => {
		const user = userEvent.setup()
		render(<ContentAuditView itemId={ITEM_ID} />)

		await user.selectOptions(screen.getByLabelText("Actor"), "approver")
		expect(useAudit).toHaveBeenLastCalledWith(
			{ itemId: ITEM_ID, page: 1, limit: 25, actorId: "approver" },
			true
		)

		await user.selectOptions(screen.getByLabelText("Action"), "content.publish")
		expect(useAudit).toHaveBeenLastCalledWith(
			{ itemId: ITEM_ID, page: 1, limit: 25, actorId: "approver", action: "content.publish" },
			true
		)
	})

	it("sends a date range as UTC instants", async () => {
		const user = userEvent.setup()
		render(<ContentAuditView itemId={ITEM_ID} />)

		await user.type(screen.getByLabelText("From"), "2026-09-01T00:00")
		const call = useAudit.mock.calls.at(-1)?.[0] as { from?: string }
		expect(call.from?.endsWith("Z")).toBe(true)
	})

	it("refuses an inverted range and does not query with it", async () => {
		const user = userEvent.setup()
		render(<ContentAuditView itemId={ITEM_ID} />)

		await user.type(screen.getByLabelText("From"), "2026-09-05T00:00")
		await user.type(screen.getByLabelText("To"), "2026-09-01T00:00")

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"The date range must start before it ends."
		)
		expect(useAudit.mock.calls.at(-1)?.[1]).toBe(false)
	})

	it("clears every filter at once and disables Clear when there is nothing to clear", async () => {
		const user = userEvent.setup()
		render(<ContentAuditView itemId={ITEM_ID} />)

		const clear = screen.getByRole("button", { name: "Clear Filters" })
		expect(clear).toBeDisabled()

		await user.selectOptions(screen.getByLabelText("Actor"), "editor")
		expect(clear).toBeEnabled()

		await user.click(clear)
		expect(useAudit).toHaveBeenLastCalledWith({ itemId: ITEM_ID, page: 1, limit: 25 }, true)
	})

	it("pages through a longer history", async () => {
		const user = userEvent.setup()
		useAudit.mockReturnValue(loaded({ data: { ...loaded().data, total: 60 } }))
		render(<ContentAuditView itemId={ITEM_ID} />)

		const navigation = screen.getByRole("navigation", { name: "Audit history pages" })
		expect(navigation).toHaveTextContent("Page 1 of 3")
		expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()

		await user.click(screen.getByRole("button", { name: "Next" }))
		expect(useAudit).toHaveBeenLastCalledWith({ itemId: ITEM_ID, page: 2, limit: 25 }, true)
	})

	it("explains an empty result instead of showing a bare list", () => {
		useAudit.mockReturnValue(loaded({ data: { ...loaded().data, entries: [], total: 0 } }))
		render(<ContentAuditView itemId={ITEM_ID} />)

		expect(screen.getByText("No Matching Entries")).toBeInTheDocument()
		expect(screen.getByText(/Clear them to see the whole history/i)).toBeInTheDocument()
	})

	it("shows accessible loading and retryable error states", async () => {
		useAudit.mockReturnValue({ isPending: true, isError: false, data: undefined })
		const { rerender } = render(<ContentAuditView itemId={ITEM_ID} />)
		expect(screen.getByRole("status", { name: "Loading audit history…" })).toBeInTheDocument()

		const refetch = vi.fn()
		useAudit.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		rerender(<ContentAuditView itemId={ITEM_ID} />)

		const alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		await userEvent.click(screen.getByRole("button", { name: "Try Again" }))
		expect(refetch).toHaveBeenCalledTimes(1)
	})

	it("offers no control that could change the history", () => {
		render(<ContentAuditView itemId={ITEM_ID} />)

		const labels = screen
			.getAllByRole("button")
			.map(button => button.textContent?.trim())
			.filter(Boolean)
		expect(labels).toEqual(["Clear Filters"])
	})
})
