import { describe, expect, it } from "vitest"

import { PERMISSION_NAMES, ROLE_NAMES } from "./rbac.catalog.js"

describe("RBAC catalog", () => {
	it("contains all six Annex H roles while retaining legacy roles", () => {
		expect(ROLE_NAMES).toEqual([
			"Guest User",
			"Registered End User",
			"Content Administrator",
			"Content Approver",
			"Reports & Analytics User",
			"System Administrator",
			"Admin",
			"Manager",
			"User",
		])
		expect(ROLE_NAMES).not.toEqual(expect.arrayContaining(["Guest", "Registered User"]))
	})

	it("contains every Domain Model dot-form permission", () => {
		expect(PERMISSION_NAMES).toEqual(
			expect.arrayContaining([
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
			])
		)
	})
})
