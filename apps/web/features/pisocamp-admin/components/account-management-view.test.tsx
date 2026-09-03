import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AccountManagementView } from "./account-management-view"

const useAccounts = vi.fn()
const useSetStatus = vi.fn()

vi.mock("@/features/pisocamp-admin/api/accounts.hooks", () => ({
	usePisoCampAccountsQuery: (input: unknown) => useAccounts(input),
	useSetPisoCampAccountStatusMutation: () => useSetStatus(),
}))

const alice = {
	id: "user-alice",
	name: "Alice Reader",
	email: "alice@example.test",
	status: "active" as const,
	reason: null,
	statusChangedAt: null,
	roles: ["Registered End User"],
}

const bob = {
	id: "user-bob",
	name: "Bob Builder",
	email: "bob@example.test",
	status: "deactivated" as const,
	reason: "Left the organisation",
	statusChangedAt: "2026-09-01T00:00:00.000Z",
	roles: [],
}

describe("AccountManagementView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAccounts.mockReturnValue({
			isPending: false,
			isError: false,
			data: { accounts: [alice, bob], total: 2, page: 1, limit: 20 },
			refetch: vi.fn(),
		})
		useSetStatus.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
		})
	})

	it("shows each account with its status and the reason it carries", () => {
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Bob Builder/ })
		expect(within(row).getByText("Deactivated")).toBeInTheDocument()
		expect(within(row).getByText("Left the organisation")).toBeInTheDocument()
	})

	it("asks before deactivating, and refuses to do it without a reason", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSetStatus.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Deactivate" }))

		// Ending somebody's access is not an accident anyone should be able to
		// have by clicking once.
		expect(screen.getByRole("dialog")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Deactivate Account" }))

		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Give a reason, so the change can be explained later."
		)
	})

	it("sends the reason with the deactivation", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSetStatus.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Deactivate" }))
		await user.type(screen.getByLabelText("Reason"), "  Left the organisation  ")
		await user.click(screen.getByRole("button", { name: "Deactivate Account" }))

		expect(mutate.mock.calls[0]?.[0]).toEqual({
			accountId: "user-alice",
			status: "deactivated",
			// Trimmed: surrounding whitespace is not part of anybody's reason.
			reason: "Left the organisation",
		})
	})

	it("reactivates without asking for a reason", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSetStatus.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Bob Builder/ })
		await user.click(within(row).getByRole("button", { name: "Reactivate" }))

		// A reason attached to restoring access would only ever be misread as
		// one for removing it.
		expect(mutate.mock.calls[0]?.[0]).toEqual({
			accountId: "user-bob",
			status: "active",
		})
	})

	it("asks the server for the search and status the person chose", async () => {
		const user = userEvent.setup()
		render(<AccountManagementView />)

		await user.type(screen.getByLabelText("Search"), "alice")
		await user.click(screen.getByRole("button", { name: "Search" }))

		expect(useAccounts.mock.calls.at(-1)?.[0]).toMatchObject({ search: "alice", page: 1 })

		await user.selectOptions(screen.getByLabelText("Status"), "deactivated")

		expect(useAccounts.mock.calls.at(-1)?.[0]).toMatchObject({ status: "deactivated" })
	})

	it("does not ask for an empty search or an empty status", () => {
		render(<AccountManagementView />)

		const input = useAccounts.mock.calls.at(-1)?.[0] as Record<string, unknown>
		// An empty box is not a search for the empty string.
		expect(input).not.toHaveProperty("search")
		expect(input).not.toHaveProperty("status")
	})

	it("says plainly when nothing matches", () => {
		useAccounts.mockReturnValue({
			isPending: false,
			isError: false,
			data: { accounts: [], total: 0, page: 1, limit: 20 },
			refetch: vi.fn(),
		})
		render(<AccountManagementView />)

		expect(screen.getByText("No account matches that search.")).toBeInTheDocument()
	})

	it("shows the server's reason when a status change is refused", () => {
		useSetStatus.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: true,
			error: new Error("You cannot change the status of your own account"),
		})
		render(<AccountManagementView />)

		expect(
			screen.getByText("You cannot change the status of your own account")
		).toBeInTheDocument()
	})

	it("offers a way back when the list could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useAccounts.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<AccountManagementView />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
