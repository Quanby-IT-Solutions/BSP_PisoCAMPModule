import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AccessProfile } from "@/features/dashboard/lib/access"

import { DashboardOverview } from "./dashboard-overview"

const { analyticsQueryHook, moduleEntryTodayTile } = vi.hoisted(() => ({
	analyticsQueryHook: vi.fn(),
	moduleEntryTodayTile: vi.fn(() => {
		analyticsQueryHook()
		return <section aria-label="Module entries today">Analytics tile</section>
	}),
}))

vi.mock("@/features/analytics/components/module-entry-today-tile", () => ({
	ModuleEntryTodayTile: moduleEntryTodayTile,
}))

vi.mock("@/features/todos/api/todos.hooks", () => ({
	useTodosQuery: () => ({ data: [], isError: false, isLoading: false, fetchStatus: "idle" }),
}))

vi.mock("@/features/user-management/api/rbac.hooks", () => ({
	useUsersQuery: () => ({ data: [], isError: false, isLoading: false, fetchStatus: "idle" }),
	useRolesQuery: () => ({ data: [], isError: false, isLoading: false, fetchStatus: "idle" }),
}))

vi.mock("@/services/tanstack-query/use-query-loading", () => ({
	useIsQueryLoading: () => () => false,
}))

const user = { name: "Ada Lovelace", email: "ada@example.test" }

function renderDashboard(access: AccessProfile) {
	return render(<DashboardOverview user={user} access={access} />)
}

describe("DashboardOverview analytics permission boundary", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not mount or query analytics without reports.dashboards.view", () => {
		renderDashboard({ roles: ["User"], permissions: [] })

		expect(screen.queryByRole("region", { name: "Module entries today" })).not.toBeInTheDocument()
		expect(moduleEntryTodayTile).not.toHaveBeenCalled()
		expect(analyticsQueryHook).not.toHaveBeenCalled()
		expect(screen.getByRole("heading", { name: "Welcome back, Ada" })).toBeVisible()
		expect(screen.getByText("Your permissions")).toBeVisible()
		expect(screen.getByText("Quick actions")).toBeVisible()
		expect(screen.getByText("Recent todos")).toBeVisible()
	})

	it("mounts exactly one query-owning tile when reports.dashboards.view is granted", () => {
		renderDashboard({ roles: ["Reporter"], permissions: ["reports.dashboards.view"] })

		expect(screen.getByRole("region", { name: "Module entries today" })).toBeVisible()
		expect(moduleEntryTodayTile).toHaveBeenCalledOnce()
		expect(analyticsQueryHook).toHaveBeenCalledOnce()
		expect(screen.getByRole("heading", { name: "Welcome back, Ada" })).toBeVisible()
		expect(screen.getByText("Your permissions")).toBeVisible()
		expect(screen.getByText("Quick actions")).toBeVisible()
		expect(screen.getByText("Recent todos")).toBeVisible()
	})
})
