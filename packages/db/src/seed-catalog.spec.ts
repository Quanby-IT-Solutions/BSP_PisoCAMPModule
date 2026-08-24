import { describe, expect, it } from "vitest"

import { DEFAULT_MODULE_CONFIGURATION, ROLE_PERMISSION_NAMES } from "./seed-catalog.js"

describe("F2 seed catalog", () => {
	it("grants module configuration management to System Administrator", () => {
		expect(ROLE_PERMISSION_NAMES["System Administrator"]).toContain("admin.config.manage")
	})

	it("uses the exact Annex H end-user role names", () => {
		expect(Object.keys(ROLE_PERMISSION_NAMES)).toEqual(
			expect.arrayContaining(["Guest User", "Registered End User"])
		)
		expect(Object.keys(ROLE_PERMISSION_NAMES)).not.toEqual(
			expect.arrayContaining(["Guest", "Registered User"])
		)
	})

	it("leaves reports PII access unassigned", () => {
		for (const permissions of Object.values(ROLE_PERMISSION_NAMES)) {
			expect(permissions).not.toContain("reports.pii.view")
		}
	})

	it("materializes legacy Admin permissions explicitly", () => {
		expect(ROLE_PERMISSION_NAMES.Admin).toEqual(
			expect.arrayContaining([
				"posts:read",
				"posts:create",
				"posts:edit",
				"posts:delete",
				"posts:*",
				"users:read",
				"users:manage",
				"users:read-directory",
			])
		)
	})

	it("defines the 30-minute default configuration", () => {
		expect(DEFAULT_MODULE_CONFIGURATION).toEqual({ session_inactivity_minutes: 30 })
	})
})
