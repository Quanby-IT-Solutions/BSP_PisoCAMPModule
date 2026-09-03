import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuditLogView } from "./audit-log-view"

const useAudit = vi.fn()
const useGenerate = vi.fn()

vi.mock("@/features/pisocamp-admin/api/audit.hooks", () => ({
	usePisoCampAuditQuery: (input: unknown) => useAudit(input),
}))

vi.mock("@/features/reports/api/reports.hooks", () => ({
	useGenerateReportMutation: () => useGenerate(),
	reportExportUrl: (runId: string, format: string) =>
		`http://api.test/v1/admin/pisocamp/reports/runs/${runId}/export/${format}`,
}))

const change = {
	id: 2,
	domain: "pisocamp",
	action: "account.status.update",
	outcome: "success" as const,
	actorId: "user-ada",
	actorEmail: "ada@example.test",
	targetType: "user",
	targetId: "user-ben",
	oldValue: { status: "active" },
	newValue: { status: "deactivated" },
	reason: "Left the organisation",
	createdAt: new Date("2026-09-03T02:00:00.000Z"),
}

const denial = {
	id: 1,
	domain: "rbac",
	action: "permission_denied",
	outcome: "denied" as const,
	actorId: "user-ben",
	actorEmail: null,
	targetType: "handler",
	targetId: "ReportsController.generate",
	oldValue: null,
	newValue: { missingPermissions: ["reports.reports.generate"] },
	reason: null,
	createdAt: new Date("2026-09-02T02:00:00.000Z"),
}

describe("AuditLogView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAudit.mockReturnValue({
			isPending: false,
			isError: false,
			data: { entries: [change, denial], nextCursor: null },
			refetch: vi.fn(),
		})
		useGenerate.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
	})

	it("shows the actor, action, target and what changed", () => {
		render(<AuditLogView />)

		const row = screen.getByRole("row", { name: /account.status.update/ })
		expect(within(row).getByText("ada@example.test")).toBeInTheDocument()
		expect(within(row).getByText("user user-ben")).toBeInTheDocument()
		expect(within(row).getByText('{"status":"active"}')).toBeInTheDocument()
		expect(within(row).getByText('{"status":"deactivated"}')).toBeInTheDocument()
	})

	it("shows a refusal as a refusal", () => {
		render(<AuditLogView />)

		const row = screen.getByRole("row", { name: /permission_denied/ })
		// A denial that read like a success would be worse than not showing it.
		expect(within(row).getByText("Denied")).toBeInTheDocument()
		// The entry outlives the account: the id stands in for a missing address.
		expect(within(row).getByText("user-ben")).toBeInTheDocument()
	})

	it("asks the server for the filters that were applied", async () => {
		const user = userEvent.setup()
		render(<AuditLogView />)

		await user.type(screen.getByLabelText("Action"), "report.generate")
		await user.type(screen.getByLabelText("From"), "2026-09-01")
		await user.click(screen.getByRole("button", { name: "Apply Filters" }))

		expect(useAudit.mock.calls.at(-1)?.[0]).toMatchObject({
			action: "report.generate",
			from: "2026-09-01",
		})
	})

	it("does not send an empty filter", () => {
		render(<AuditLogView />)

		const input = useAudit.mock.calls.at(-1)?.[0] as Record<string, unknown>
		// An empty box is not a filter for the empty string.
		expect(input).not.toHaveProperty("action")
		expect(input).not.toHaveProperty("actorId")
		expect(input).toMatchObject({ limit: 50 })
	})

	it("pages forward with the cursor and back again", async () => {
		const user = userEvent.setup()
		useAudit.mockReturnValue({
			isPending: false,
			isError: false,
			data: { entries: [change], nextCursor: 7 },
			refetch: vi.fn(),
		})
		render(<AuditLogView />)

		await user.click(screen.getByRole("button", { name: "Older" }))
		expect(useAudit.mock.calls.at(-1)?.[0]).toMatchObject({ before: 7 })

		await user.click(screen.getByRole("button", { name: "Newer" }))
		expect(useAudit.mock.calls.at(-1)?.[0]).not.toHaveProperty("before")
	})

	it("offers no older page when there is none", () => {
		render(<AuditLogView />)

		expect(screen.getByRole("button", { name: "Older" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Newer" })).toBeDisabled()
	})

	it("says plainly when nothing matches", () => {
		useAudit.mockReturnValue({
			isPending: false,
			isError: false,
			data: { entries: [], nextCursor: null },
			refetch: vi.fn(),
		})
		render(<AuditLogView />)

		expect(screen.getByText("No entry matches those filters.")).toBeInTheDocument()
	})

	it("exports through the report framework, carrying the filters", async () => {
		const user = userEvent.setup()
		const mutate = vi.fn()
		useGenerate.mockReturnValue({
			mutate,
			isPending: false,
			isError: false,
			error: null,
			data: undefined,
		})
		render(<AuditLogView />)

		await user.type(screen.getByLabelText("Action"), "report.generate")
		await user.click(screen.getByRole("button", { name: "Apply Filters" }))
		await user.click(screen.getByRole("button", { name: "Prepare Export" }))

		// AN-9's path, so the file is rendered by the same renderers and the
		// export is recorded by AN-9's own entry — in this very trail.
		expect(mutate.mock.calls[0]?.[0]).toMatchObject({
			definitionKey: "audit",
			filters: { activityType: "report.generate" },
		})
	})

	it("offers the prepared export in each format", async () => {
		useGenerate.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
			data: {
				id: "6f6e3f1e-6c5a-4a1f-9d4a-4b9f4f7f4d21",
				from: "2026-09-01",
				to: "2026-09-03",
			},
		})
		render(<AuditLogView />)

		expect(
			screen.getByRole("link", {
				name: "Export the audit log for 2026-09-01 to 2026-09-03 as Excel",
			})
		).toHaveAttribute(
			"href",
			"http://api.test/v1/admin/pisocamp/reports/runs/6f6e3f1e-6c5a-4a1f-9d4a-4b9f4f7f4d21/export/xlsx"
		)
	})

	it("offers a way back when the log could not be loaded", async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		useAudit.mockReturnValue({ isPending: false, isError: true, refetch })
		render(<AuditLogView />)

		await user.click(screen.getByRole("button", { name: /try again/i }))

		expect(refetch).toHaveBeenCalledTimes(1)
	})
})
