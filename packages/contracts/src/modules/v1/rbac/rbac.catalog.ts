import { z } from "zod"

/**
 * RBAC catalog
 *
 * Shared role and permission constants, Zod enums, and inferred types.
 * Consumed by the backend RBAC guard, seed scripts, and the frontend.
 */

// ---------------------------------------------------------------------------
// Role names
// ---------------------------------------------------------------------------

/** Canonical role names. Order is significant for display only. */
export const ROLE_NAMES = [
	"Guest User",
	"Registered End User",
	"Content Administrator",
	"Content Approver",
	"Reports & Analytics User",
	"System Administrator",
	"Admin",
	"Manager",
	"User",
] as const

/** Zod enum validating a role name. */
export const RoleNameSchema = z.enum(ROLE_NAMES)

/**
 * Protected legacy role name retained for compatibility and grant/removal
 * invariants. It has no authorization bypass; access comes only from its
 * explicit permission rows.
 */
export const ADMIN_ROLE = "Admin" as const

/** A valid role name. */
export type RoleName = z.infer<typeof RoleNameSchema>

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

/**
 * Permission identifiers retain two compatibility forms:
 *
 * - Annex H dot-form permissions (for example `admin.config.manage`) require
 *   exact matches; dots do not imply hierarchy or wildcard semantics.
 * - Legacy colon-form permissions use `resource:action`. A legacy
 *   `resource:*` grant matches any colon-form action on that resource, so
 *   `posts:*` satisfies `posts:read`, `posts:create`, `posts:edit`, and
 *   `posts:delete`.
 */
export const PERMISSION_NAMES = [
	// Domain Model dot-form permissions
	"content.items.edit",
	"content.assets.upload",
	"content.items.submit",
	"content.items.approve",
	"content.items.publish",
	"content.items.restore",
	"content.items.preview",
	"content.audit.view",
	"surveys.triggers.configure",
	"reports.dashboards.view",
	"reports.reports.generate",
	"reports.reports.export",
	"reports.pii.view",
	"admin.accounts.manage",
	"admin.roles.assign",
	"admin.config.manage",
	"admin.audit.view",
	"admin.notifications.send",
	"admin.integrations.manage",
	// Granular post actions
	"posts:read",
	"posts:create",
	"posts:edit",
	"posts:delete",
	// Wildcard: grants all actions on the `posts` resource (resource:* convention)
	"posts:*",
	// User management actions
	"users:read",
	"users:manage",
	// AZ-5 / F-51: directory PII, split from `users:read`.
	//
	// `users:read` grants operational reads — the user list with names and
	// roles, and (per AZ-1) support-ticket triage. It used to also yield every
	// email address, so granting someone ticket triage handed them the complete
	// email directory as a side effect.
	//
	// Note the naming: `users:read-directory` is deliberately NOT
	// `users:directory-read`, because the wildcard convention above matches on
	// the segment before the colon. A `users:*` holder still gets it, which is
	// intended — that wildcard means "everything about users".
	"users:read-directory",
] as const

/** Zod enum validating a permission name. */
export const PermissionNameSchema = z.enum(PERMISSION_NAMES)

/** A valid permission name. */
export type PermissionName = z.infer<typeof PermissionNameSchema>
