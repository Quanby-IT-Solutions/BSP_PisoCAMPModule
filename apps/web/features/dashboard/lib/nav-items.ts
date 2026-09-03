import {
	AccountSetting01Icon,
	DashboardSquare01Icon,
	FileEditIcon,
	Task01Icon,
	Ticket01Icon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { type IconSvgElement } from "@hugeicons/react"

import { type PermissionName } from "@repo/contracts"

import { canAccess, type AccessProfile, type RoleRequirement } from "./access"

type DashboardHref = `/${string}`

export interface DashboardNavItem {
	label: string
	href: DashboardHref
	icon: IconSvgElement
	section?: string
	requiredPermission?: PermissionName | readonly PermissionName[]
	requiredRole?: RoleRequirement
}

export const navItems: readonly DashboardNavItem[] = [
	{
		label: "Dashboard",
		href: "/dashboard",
		icon: DashboardSquare01Icon,
	},
	{
		label: "Submit Ticket",
		href: "/submit-ticket",
		icon: Ticket01Icon,
	},
	{
		label: "Todos / Posts",
		href: "/todos",
		icon: Task01Icon,
		requiredPermission: "posts:read",
	},
	{
		label: "User Management",
		href: "/user-management",
		icon: UserMultipleIcon,
		section: "Administration",
		requiredPermission: ["users:read", "users:manage"],
	},
	{
		label: "Accounts",
		href: "/pisocamp/accounts",
		icon: UserMultipleIcon,
		section: "Administration",
		requiredPermission: "admin.accounts.manage",
	},
	{
		label: "Audit Log",
		href: "/pisocamp/audit",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "admin.audit.view",
	},
	{
		label: "Module Configuration",
		href: "/pisocamp/config",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "admin.config.manage",
	},
	{
		label: "Engagement",
		href: "/pisocamp/engagement",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "reports.dashboards.view",
	},
	{
		label: "Demographics",
		href: "/pisocamp/demographics",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "reports.dashboards.view",
	},
	{
		label: "Technical Health",
		href: "/pisocamp/technical",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "reports.dashboards.view",
	},
	{
		label: "Reports",
		href: "/pisocamp/reports",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "reports.reports.generate",
	},
	{
		label: "Survey Triggers",
		href: "/pisocamp/survey-triggers",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "surveys.triggers.configure",
	},
	{
		label: "Content",
		href: "/pisocamp/content",
		icon: FileEditIcon,
		section: "Administration",
		requiredPermission: "content.items.edit",
	},
	{
		label: "Content Review",
		href: "/pisocamp/content/review",
		icon: FileEditIcon,
		section: "Administration",
		requiredPermission: "content.items.approve",
	},
]

export const dashboardRouteTitles: readonly Pick<DashboardNavItem, "href" | "label">[] = [
	...navItems.map(({ href, label }) => ({ href, label })),
	{
		label: "Account",
		href: "/account",
	},
]

export function getDashboardRouteTitle(pathname: string): string {
	if (/^\/pisocamp\/content\/review\/[^/]+$/.test(pathname)) {
		return "Review Content"
	}

	if (pathname === "/pisocamp/content/review") {
		return "Content Review"
	}

	if (pathname === "/pisocamp/content/new") {
		return "New Content"
	}

	if (/^\/pisocamp\/content\/[^/]+\/edit$/.test(pathname)) {
		return "Edit Content"
	}

	const currentRoute = dashboardRouteTitles.find(
		route => pathname === route.href || pathname.startsWith(`${route.href}/`)
	)

	return currentRoute?.label ?? "Dashboard"
}

export function getActiveDashboardNavHref(
	pathname: string,
	items: readonly Pick<DashboardNavItem, "href">[] = navItems
): DashboardHref | undefined {
	let activeHref: DashboardHref | undefined

	for (const item of items) {
		const matches = pathname === item.href || pathname.startsWith(`${item.href}/`)
		if (matches && (!activeHref || item.href.length > activeHref.length)) {
			activeHref = item.href
		}
	}

	return activeHref
}

export function getAccessibleNavItems(access: AccessProfile): DashboardNavItem[] {
	return navItems.filter(item =>
		canAccess(access, {
			requiredPermission: item.requiredPermission,
			requiredRole: item.requiredRole,
		})
	)
}
