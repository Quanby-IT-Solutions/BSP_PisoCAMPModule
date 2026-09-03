import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AccountManagementView } from "./account-management-view"

const useAccounts = vi.fn()
const useSetStatus = vi.fn()
const useRoles = vi.fn()
const useSetRoles = vi.fn()
const useDeleteData = vi.fn()

vi.mock("@/features/pisocamp-admin/api/accounts.hooks", () => ({
	usePisoCampAccountsQuery: (input: unknown) => useAccounts(input),
	useSetPisoCampAccountStatusMutation: () => useSetStatus(),
	usePisoCampRolesQuery: () => useRoles(),
	useSetPisoCampUserRolesMutation: () => useSetRoles(),
	useDeletePisoCampSubjectDataMutation: () => useDeleteData(),
}))

const ROLES = [
	{
		name: "Reports & Analytics User",
		description: "Reads dashboards",
		permissions: ["reports.dashboards.view", "reports.reports.generate"],
		userCount: 1,
	},
	{
		name: "Registered End User",
		description: null,
		permissions: [],
		userCount: 4,
	},
]

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
		useRoles.mockReturnValue({
			isPending: false,
			isError: false,
			data: { roles: ROLES },
		})
		useSetRoles.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
		})
		useDeleteData.mockReturnValue({
			mutate: vi.fn(),
			reset: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
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

	it("shows each role with the permission keys it carries", async () => {
		const user = userEvent.setup()
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Edit Roles" }))

		const dialog = screen.getByRole("dialog")
		// Least privilege is a claim somebody has to be able to check.
		expect(
			within(dialog).getByText("reports.dashboards.view, reports.reports.generate")
		).toBeInTheDocument()
		// A role that carries nothing says so, rather than showing a blank line.
		expect(within(dialog).getByText("No permission keys")).toBeInTheDocument()
	})

	it("ticks the roles the account already holds", async () => {
		const user = userEvent.setup()
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Edit Roles" }))

		expect(screen.getByRole("checkbox", { name: /Registered End User/ })).toBeChecked()
		expect(
			screen.getByRole("checkbox", { name: /Reports & Analytics User/ })
		).not.toBeChecked()
	})

	it("sends the complete set of roles, not the change", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSetRoles.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Edit Roles" }))
		await user.click(screen.getByRole("checkbox", { name: /Reports & Analytics User/ }))
		await user.click(screen.getByRole("button", { name: "Save Roles" }))

		// The whole answer: the server works out the difference, so the screen
		// never has to reason about what it is replacing.
		expect(mutate.mock.calls[0]?.[0]).toEqual({
			userId: "user-alice",
			roles: ["Registered End User", "Reports & Analytics User"],
		})
	})

	it("can clear every role", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useSetRoles.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Edit Roles" }))
		await user.click(screen.getByRole("checkbox", { name: /Registered End User/ }))
		await user.click(screen.getByRole("button", { name: "Save Roles" }))

		expect(mutate.mock.calls[0]?.[0]).toEqual({ userId: "user-alice", roles: [] })
	})

	it("shows the server's reason when roles could not be saved", async () => {
		const user = userEvent.setup()
		useSetRoles.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: true,
			error: new Error("Only an Admin may grant the Admin role"),
		})
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Edit Roles" }))

		expect(screen.getByText("Only an Admin may grant the Admin role")).toBeInTheDocument()
	})

	it("says what a deletion will remove and what it will keep", async () => {
		const user = userEvent.setup()
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Delete Data" }))

		const dialog = screen.getByRole("dialog")
		// "Delete my data" and "delete my account" are different requests, and
		// an administrator pressing this should know which one they answered.
		expect(within(dialog).getByText(/consent records are kept/i)).toBeInTheDocument()
		expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument()
	})

	it("will not delete without the approval it was authorised under", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useDeleteData.mockReturnValue({
			mutate,
			reset: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Delete Data" }))
		await user.click(screen.getByRole("button", { name: "Delete Data", hidden: false }))

		expect(mutate).not.toHaveBeenCalled()
	})

	it("sends the approval reference with the deletion", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useDeleteData.mockReturnValue({
			mutate,
			reset: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Delete Data" }))
		await user.type(screen.getByLabelText("BSP approval reference"), "  DSR-2026-014  ")
		await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Data" }))

		expect(mutate.mock.calls[0]?.[0]).toEqual({
			accountId: "user-alice",
			approvalReference: "DSR-2026-014",
		})
	})

	it("reports exactly what the deletion did", async () => {
		const user = userEvent.setup()
		useDeleteData.mockReturnValue({
			mutate: vi.fn(),
			reset: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: {
				accountId: "user-alice",
				profileDeleted: true,
				deviceLinksRemoved: 2,
				sessionsEnded: 3,
				surveyResponsesPseudonymised: 4,
				triviaResponsesDeleted: 5,
				consentRecordsRetained: 6,
			},
		})
		render(<AccountManagementView />)

		const row = screen.getByRole("row", { name: /Alice Reader/ })
		await user.click(within(row).getByRole("button", { name: "Delete Data" }))

		// Counted, not claimed: "we deleted your data" is something somebody has
		// to be able to check.
		const dialog = screen.getByRole("dialog")
		expect(within(dialog).getByText("Sessions ended: 3")).toBeInTheDocument()
		expect(within(dialog).getByText("Consent records kept: 6")).toBeInTheDocument()
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
