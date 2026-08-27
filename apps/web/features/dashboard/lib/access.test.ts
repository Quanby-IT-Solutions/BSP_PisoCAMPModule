import { describe, expect, it } from "vitest"

import { canAccess, type AccessProfile } from "./access"
import {
	getAccessibleNavItems,
	getActiveDashboardNavHref,
	getDashboardRouteTitle,
	navItems,
} from "./nav-items"

const noAccess: AccessProfile = {
	roles: [],
	permissions: [],
}

describe("canAccess", () => {
	it("allows base items without requirements", () => {
		expect(canAccess(noAccess, {})).toBe(true)
	})

	it("does not allow the legacy Admin role to bypass explicit permissions", () => {
		expect(
			canAccess({ roles: ["Admin"], permissions: [] }, { requiredPermission: "users:manage" })
		).toBe(false)
	})

	it("allows exact permission matches", () => {
		expect(
			canAccess({ roles: [], permissions: ["posts:read"] }, { requiredPermission: "posts:read" })
		).toBe(true)
	})

	it("allows resource wildcard permission matches", () => {
		expect(
			canAccess({ roles: [], permissions: ["posts:*"] }, { requiredPermission: "posts:delete" })
		).toBe(true)
	})

	it("allows any listed permission to match", () => {
		expect(
			canAccess(
				{ roles: [], permissions: ["users:manage"] },
				{ requiredPermission: ["users:read", "users:manage"] }
			)
		).toBe(true)
	})

	it("allows role requirements to match", () => {
		expect(canAccess({ roles: ["Manager"], permissions: [] }, { requiredRole: "Manager" })).toBe(
			true
		)
	})

	it("denies restricted items when no requirement matches", () => {
		expect(canAccess(noAccess, { requiredPermission: "users:read" })).toBe(false)
		expect(canAccess({ roles: ["User"], permissions: [] }, { requiredRole: "Manager" })).toBe(false)
	})
})

describe("navItems", () => {
	it("defines base and RBAC-gated dashboard destinations", () => {
		expect(navItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: "Dashboard", href: "/dashboard" }),
				expect.objectContaining({ label: "Submit Ticket", href: "/submit-ticket" }),
				expect.objectContaining({
					label: "Todos / Posts",
					href: "/todos",
					requiredPermission: "posts:read",
				}),
				expect.objectContaining({
					label: "User Management",
					href: "/user-management",
					section: "Administration",
					requiredPermission: ["users:read", "users:manage"],
				}),
				expect.objectContaining({
					label: "Module Configuration",
					href: "/pisocamp/config",
					requiredPermission: "admin.config.manage",
				}),
				expect.objectContaining({
					label: "Content",
					href: "/pisocamp/content",
					section: "Administration",
					requiredPermission: "content.items.edit",
				}),
				expect.objectContaining({
					label: "Content Review",
					href: "/pisocamp/content/review",
					section: "Administration",
					requiredPermission: "content.items.approve",
				}),
			])
		)
	})

	it("filters visible items from the shared access helper", () => {
		expect(getAccessibleNavItems(noAccess).map(item => item.label)).toEqual([
			"Dashboard",
			"Submit Ticket",
		])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["posts:*"] }).map(item => item.label)
		).toContain("Todos / Posts")

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["users:read"] }).map(item => item.label)
		).toContain("User Management")

		expect(
			getAccessibleNavItems({ roles: ["Admin"], permissions: [] }).map(item => item.label)
		).toEqual(["Dashboard", "Submit Ticket"])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["admin.config.manage"] }).map(
				item => item.label
			)
		).toContain("Module Configuration")

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["content.items.edit"] }).map(
				item => item.label
			)
		).toContain("Content")

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["content.items.approve"] }).map(
				item => item.label
			)
		).toContain("Content Review")
		expect(
			getAccessibleNavItems({ roles: [], permissions: ["content.items.edit"] }).map(
				item => item.label
			)
		).not.toContain("Content Review")
	})

	it("resolves mobile header titles from dashboard routes", () => {
		expect(getDashboardRouteTitle("/dashboard")).toBe("Dashboard")
		expect(getDashboardRouteTitle("/submit-ticket")).toBe("Submit Ticket")
		expect(getDashboardRouteTitle("/todos")).toBe("Todos / Posts")
		expect(getDashboardRouteTitle("/user-management")).toBe("User Management")
		expect(getDashboardRouteTitle("/pisocamp/config")).toBe("Module Configuration")
		expect(getDashboardRouteTitle("/pisocamp/content")).toBe("Content")
		expect(getDashboardRouteTitle("/pisocamp/content/new")).toBe("New Content")
		expect(getDashboardRouteTitle("/pisocamp/content/abc/edit")).toBe("Edit Content")
		expect(getDashboardRouteTitle("/pisocamp/content/review")).toBe("Content Review")
		expect(getDashboardRouteTitle("/pisocamp/content/review/abc")).toBe("Review Content")
		expect(getDashboardRouteTitle("/account")).toBe("Account")
	})

	it("selects only the longest matching navigation destination for nested routes", () => {
		expect(getActiveDashboardNavHref("/pisocamp/content/review")).toBe("/pisocamp/content/review")
		expect(getActiveDashboardNavHref("/pisocamp/content/review/item-123")).toBe(
			"/pisocamp/content/review"
		)
		expect(getActiveDashboardNavHref("/pisocamp/content/item-123/edit")).toBe("/pisocamp/content")
		expect(getActiveDashboardNavHref("/todos/123")).toBe("/todos")
		expect(getActiveDashboardNavHref("/unknown")).toBeUndefined()
	})
})
