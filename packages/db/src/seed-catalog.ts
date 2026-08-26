import type { PermissionName, RoleName } from "@repo/contracts"

import { PISOCAMP_CURRENCY_CATALOG } from "./pisocamp-currency-catalog.js"

export const PISOCAMP_CURRENCY_SERIES_SEED = Object.freeze(
	PISOCAMP_CURRENCY_CATALOG.map(({ denominations: _denominations, ...currencySeries }) =>
		Object.freeze(currencySeries)
	)
)

export const PISOCAMP_CURRENCY_DENOMINATION_SEED = Object.freeze(
	PISOCAMP_CURRENCY_CATALOG.flatMap(currencySeries =>
		currencySeries.denominations.map(denomination =>
			Object.freeze({ seriesCode: currencySeries.code, ...denomination })
		)
	)
)

export const DEFAULT_MODULE_CONFIGURATION = Object.freeze({
	session_inactivity_minutes: 30,
	active_privacy_notice_version: "2024-12-26",
})

/** Authoritative metadata only. The approved legal body enters through the import seam. */
export const BSP_PRIVACY_NOTICE_METADATA = Object.freeze({
	id: "1cca6b9c-b217-5e59-b679-c9368763274d",
	version: "2024-12-26",
	title: "BSP Mobile App Privacy Notice",
	sourceUrl: "https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx",
	effectiveAt: new Date("2024-12-26T00:00:00.000Z"),
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
