import { describe, expect, it } from "vitest"

import {
	BSP_PRIVACY_NOTICE_METADATA,
	DEFAULT_MODULE_CONFIGURATION,
	ROLE_PERMISSION_NAMES,
} from "./seed-catalog.js"

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
		expect(DEFAULT_MODULE_CONFIGURATION).toEqual({
			session_inactivity_minutes: 30,
			active_privacy_notice_version: "2024-12-26",
		})
	})

	it("stores authoritative notice metadata without inventing an approved body", () => {
		expect(BSP_PRIVACY_NOTICE_METADATA).toEqual({
			id: "1cca6b9c-b217-5e59-b679-c9368763274d",
			version: "2024-12-26",
			title: "BSP Mobile App Privacy Notice",
			sourceUrl: "https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx",
			effectiveAt: new Date("2024-12-26T00:00:00.000Z"),
		})
		expect(BSP_PRIVACY_NOTICE_METADATA).not.toHaveProperty("body")
	})
})
