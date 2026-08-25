import { getTableColumns, getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import {
	consentRecords,
	moduleConfiguration,
	pisoCampAccountState,
	pisoCampCities,
	pisoCampDeviceAccountLinks,
	pisoCampProfiles,
	pisoCampRegions,
	privacyNotices,
	schema,
} from "./schema.js"

describe("F3 profile database schema", () => {
	it("defines catalog, demographic profile, and unique device link tables", () => {
		expect(getTableName(pisoCampRegions)).toBe("region")
		expect(getTableName(pisoCampCities)).toBe("city")
		expect(getTableName(pisoCampProfiles)).toBe("piso_camp_profile")
		expect(getTableName(pisoCampDeviceAccountLinks)).toBe("piso_camp_device_account_link")
		expect(getTableConfig(pisoCampProfiles).checks.map(check => check.name)).toEqual(
			expect.arrayContaining(["piso_camp_profile_gender_check", "piso_camp_profile_age_check"])
		)
		expect(getTableConfig(pisoCampDeviceAccountLinks).checks.map(check => check.name)).toContain(
			"piso_camp_device_account_link_device_check"
		)
	})
})

describe("F2 database schema", () => {
	it("defines module_configuration with its persisted value and audit columns", () => {
		expect(getTableName(moduleConfiguration)).toBe("module_configuration")
		expect(Object.keys(getTableColumns(moduleConfiguration))).toEqual(
			expect.arrayContaining(["key", "value", "updatedBy", "createdAt", "updatedAt"])
		)
		expect(schema.moduleConfiguration.table).toBe(moduleConfiguration)
	})

	it("defines account state with status and actor fields", () => {
		expect(getTableName(pisoCampAccountState)).toBe("pisocamp_account_state")
		expect(Object.keys(getTableColumns(pisoCampAccountState))).toEqual(
			expect.arrayContaining([
				"accountId",
				"status",
				"reason",
				"updatedBy",
				"createdAt",
				"updatedAt",
			])
		)
		expect(schema.pisoCampAccountState.table).toBe(pisoCampAccountState)
		expect(getTableConfig(pisoCampAccountState).checks.map(check => check.name)).toContain(
			"pisocamp_account_state_status_check"
		)
	})
})

describe("F4 consent database schema", () => {
	it("defines immutable privacy notice versions with approved-body metadata", () => {
		expect(getTableName(privacyNotices)).toBe("privacy_notice")
		expect(Object.keys(getTableColumns(privacyNotices))).toEqual([
			"id",
			"version",
			"title",
			"body",
			"sourceUrl",
			"contentSha256",
			"effectiveAt",
			"createdAt",
		])
		expect(schema.privacyNotices.table).toBe(privacyNotices)
	})

	it("defines append-only consent evidence with database checks and subject indexes", () => {
		expect(getTableName(consentRecords)).toBe("consent_record")
		expect(Object.keys(getTableColumns(consentRecords))).toEqual([
			"id",
			"accountId",
			"devicePseudoId",
			"purpose",
			"noticeId",
			"noticeVersion",
			"status",
			"respondedAt",
			"recordedAt",
		])
		const config = getTableConfig(consentRecords)
		expect(config.checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"consent_record_subject_xor_check",
				"consent_record_device_pseudo_id_check",
				"consent_record_purpose_check",
				"consent_record_status_check",
			])
		)
		expect(config.indexes.map(item => item.config.name)).toEqual(
			expect.arrayContaining([
				"consent_record_account_purpose_recorded_idx",
				"consent_record_device_purpose_recorded_idx",
			])
		)
		expect(schema.consentRecords.table).toBe(consentRecords)
	})
})
