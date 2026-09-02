import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContentVersionHistoryView } from "./content-version-history-view"

const { useVersions, useRestore, toastSuccess } = vi.hoisted(() => ({
	useVersions: vi.fn(),
	useRestore: vi.fn(),
	toastSuccess: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: toastSuccess } }))
vi.mock("@/features/pisocamp-content-admin/api/versions.hooks", () => ({
	usePisoCampContentVersionsQuery: (input: unknown) => useVersions(input),
	useRestorePisoCampContentVersionMutation: () => useRestore(),
}))

const ITEM_ID = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"

const current = {
	id: "d7e9984f-fd54-49d9-bb33-0a7c006c83f4",
	versionNo: 4,
	status: "published" as const,
	contentType: "advisory" as const,
	title: "Handle banknotes with care",
	createdBy: { id: "approver", name: "Sam Rivera" },
	createdAt: "2026-09-01T04:00:00.000Z",
	approver: { id: "approver", name: "Sam Rivera" },
	approvedAt: "2026-09-01T03:00:00.000Z",
	publisher: { id: "approver", name: "Sam Rivera" },
	publishedAt: "2026-09-01T04:00:00.000Z",
	transitionAction: "publish" as const,
	transitionComments: null,
	restoredFromVersionNo: null,
	isCurrentWorking: true,
	isCurrentPublished: true,
	restorable: false,
	differences: [],
}

const older = {
	id: "d7e9984f-fd54-49d9-bb33-0a7c006c83f3",
	versionNo: 3,
	status: "approved" as const,
	contentType: "advisory" as const,
	title: "Handle banknotes with care",
	createdBy: { id: "editor", name: "Elena Editor" },
	createdAt: "2026-09-01T02:00:00.000Z",
	approver: { id: "approver", name: "Sam Rivera" },
	approvedAt: "2026-09-01T03:00:00.000Z",
	publisher: null,
	publishedAt: null,
	transitionAction: "approve" as const,
	transitionComments: "Checked against the BSP source.",
	restoredFromVersionNo: null,
	isCurrentWorking: false,
	isCurrentPublished: false,
	restorable: true,
	differences: [
		{ field: "body" as const, previous: "Older body copy.", current: "Newer body copy." },
		{ field: "relatedLinks" as const, previous: null, current: "external BSP source https://x" },
	],
}

const history = {
	itemId: ITEM_ID,
	itemStatus: "published" as const,
	currentVersionNo: 4,
	restoreAvailable: true,
	versions: [current, older],
	page: 1,
	limit: 20,
	total: 2,
}

function loaded(overrides: Record<string, unknown> = {}) {
	return { isPending: false, isError: false, data: history, refetch: vi.fn(), ...overrides }
}

function mutation(mutate = vi.fn()) {
	return { mutate, reset: vi.fn(), isPending: false, isError: false, error: null }
}

describe("ContentVersionHistoryView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useVersions.mockReturnValue(loaded())
		useRestore.mockReturnValue(mutation())
	})

	it("lists every version newest-first with creator, approver, publisher and status", () => {
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		const entries = screen.getAllByRole("heading", { level: 2 })
		expect(entries.map(heading => heading.textContent)).toEqual(["Version 4", "Version 3"])
		expect(screen.getAllByText(/Sam Rivera/).length).toBeGreaterThan(0)
		expect(screen.getByText("Elena Editor", { exact: false })).toBeInTheDocument()
		expect(screen.getByText("Checked against the BSP source.")).toBeInTheDocument()
		expect(screen.getAllByText("Not published").length).toBe(1)
	})

	it("shows a field-level difference against the current version", () => {
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		const differences = screen.getByRole("region", { name: "Differences for version 3" })
		expect(within(differences).getByText("Body")).toBeInTheDocument()
		expect(within(differences).getByText(/Older body copy\./)).toBeInTheDocument()
		expect(within(differences).getByText(/Newer body copy\./)).toBeInTheDocument()
		expect(within(differences).getByText("Related links")).toBeInTheDocument()
		expect(within(differences).getByText(/Not set/)).toBeInTheDocument()

		const currentDifferences = screen.getByRole("region", { name: "Differences for version 4" })
		expect(within(currentDifferences).getByText("This is the current version.")).toBeInTheDocument()
	})

	it("offers restore only for a restorable version and only with the permission", () => {
		const { rerender } = render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		expect(screen.getByRole("button", { name: "Restore Version 3" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Restore Version 4" })).not.toBeInTheDocument()

		rerender(<ContentVersionHistoryView itemId={ITEM_ID} canRestore={false} />)
		expect(screen.queryByRole("button", { name: /Restore Version/ })).not.toBeInTheDocument()
	})

	it("requires a reason before restoring and keeps the dialog open when it is missing", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useRestore.mockReturnValue(mutation(mutate))
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		await user.click(screen.getByRole("button", { name: "Restore Version 3" }))
		await user.click(await screen.findByRole("button", { name: "Confirm Restore" }))

		expect(mutate).not.toHaveBeenCalled()
		expect(
			await screen.findByText("A reason is required, in plain text without HTML.")
		).toBeInTheDocument()
	})

	it("restores against the current version and reuses one request id per version", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useRestore.mockReturnValue(mutation(mutate))
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		await user.click(screen.getByRole("button", { name: "Restore Version 3" }))
		await user.type(
			await screen.findByLabelText("Reason for restoring"),
			"Reverting a bad publication."
		)
		await user.click(screen.getByRole("button", { name: "Confirm Restore" }))

		expect(mutate).toHaveBeenCalledTimes(1)
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			itemId: ITEM_ID,
			versionNo: 3,
			expectedVersionNo: 4,
			comments: "Reverting a bad publication.",
			requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		})
	})

	it("announces success and explains that publication is still required", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, callbacks) => callbacks.onSuccess())
		useRestore.mockReturnValue(mutation(mutate))
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		await user.click(screen.getByRole("button", { name: "Restore Version 3" }))
		await user.type(await screen.findByLabelText("Reason for restoring"), "Reverting.")
		await user.click(screen.getByRole("button", { name: "Confirm Restore" }))

		const status = await screen.findByRole("status")
		expect(within(status).getByText("Version Restored")).toBeInTheDocument()
		expect(
			screen.getByText(/restored as a new approved version\. Publish it to make it live\./i)
		).toBeInTheDocument()
		expect(toastSuccess).toHaveBeenCalledWith("Version restored.")
	})

	it("focuses a conflict and tells the reader to reload", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn((_input, callbacks) => callbacks.onError({ status: 409 }))
		useRestore.mockReturnValue(mutation(mutate))
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		await user.click(screen.getByRole("button", { name: "Restore Version 3" }))
		await user.type(await screen.findByLabelText("Reason for restoring"), "Reverting.")
		await user.click(screen.getByRole("button", { name: "Confirm Restore" }))

		const alert = await screen.findByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		expect(screen.getByText(/This content changed while you were reading\./i)).toBeInTheDocument()
	})

	it("explains when the item's state makes restore unavailable", () => {
		useVersions.mockReturnValue(
			loaded({
				data: {
					...history,
					itemStatus: "submitted_for_review" as const,
					restoreAvailable: false,
					versions: [current, { ...older, restorable: false }],
				},
			})
		)
		render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		expect(screen.getByText("Restore Unavailable")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Restore Version/ })).not.toBeInTheDocument()
	})

	it("shows accessible loading and retryable error states", async () => {
		useVersions.mockReturnValue({ isPending: true, isError: false, data: undefined })
		const { rerender } = render(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)
		expect(screen.getByRole("status", { name: "Loading version history…" })).toBeInTheDocument()

		const refetch = vi.fn()
		useVersions.mockReturnValue({ isPending: false, isError: true, data: undefined, refetch })
		rerender(<ContentVersionHistoryView itemId={ITEM_ID} canRestore />)

		const alert = screen.getByRole("alert")
		await waitFor(() => expect(alert).toHaveFocus())
		await userEvent.click(screen.getByRole("button", { name: "Try Again" }))
		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
