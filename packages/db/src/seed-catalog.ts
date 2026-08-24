import type { PermissionName, RoleName } from "@repo/contracts"

export const DEFAULT_MODULE_CONFIGURATION = Object.freeze({
	session_inactivity_minutes: 30,
})

/** Canonical idempotent seed bundles. Explicit grants are the only authorization source. */
export const ROLE_PERMISSION_NAMES = {
	"System Administrator": [
		"admin.accounts.manage",
		"admin.roles.assign",
		"admin.config.manage",
		"admin.audit.view",
		"admin.notifications.send",
		"admin.integrations.manage",
	],
	"Content Administrator": [
		"content.items.edit",
		"content.assets.upload",
		"content.items.submit",
		"content.items.preview",
	],
	"Content Approver": [
		"content.items.approve",
		"content.items.publish",
		"content.items.restore",
		"content.items.preview",
		"content.audit.view",
		"surveys.triggers.configure",
	],
	"Reports & Analytics User": [
		"reports.dashboards.view",
		"reports.reports.generate",
		"reports.reports.export",
	],
	"Registered End User": [],
	"Guest User": [],
	"Admin": [
		"posts:read",
		"posts:create",
		"posts:edit",
		"posts:delete",
		"posts:*",
		"users:read",
		"users:manage",
		"users:read-directory",
	],
	"Manager": ["posts:*", "users:read"],
	"User": ["posts:read"],
} as const satisfies Record<RoleName, readonly PermissionName[]>
