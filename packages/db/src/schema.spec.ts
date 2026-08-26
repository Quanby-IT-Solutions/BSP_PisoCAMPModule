import { getTableColumns, getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import {
	consentRecords,
	contentItems,
	contentVersions,
	moduleConfiguration,
	pisoCampAccountState,
	pisoCampCities,
	pisoCampCurrencyDenominations,
	pisoCampCurrencySeries,
	pisoCampDeviceAccountLinks,
	pisoCampProfiles,
	pisoCampRegions,
	privacyNotices,
	relatedLinks,
	schema,
} from "./schema.js"

describe("CM-1 content database schema", () => {
	it("defines the controlled currency catalog with composite denomination identity", () => {
		expect(getTableName(pisoCampCurrencySeries)).toBe("piso_camp_currency_series")
		expect(getTableName(pisoCampCurrencyDenominations)).toBe("piso_camp_currency_denomination")
		expect(Object.keys(getTableColumns(pisoCampCurrencySeries))).toEqual([
			"code",
			"name",
			"mediaKind",
			"sourceUrl",
			"catalogVersion",
		])
		expect(Object.keys(getTableColumns(pisoCampCurrencyDenominations))).toEqual([
			"seriesCode",
			"code",
			"minorUnitValue",
			"label",
			"sortOrder",
		])
		expect(getTableConfig(pisoCampCurrencyDenominations).primaryKeys).toHaveLength(1)
		expect(schema.pisoCampCurrencySeries.table).toBe(pisoCampCurrencySeries)
		expect(schema.pisoCampCurrencyDenominations.table).toBe(pisoCampCurrencyDenominations)
	})

	it("defines stable items, immutable versions, and version-scoped related links", () => {
		expect(getTableName(contentItems)).toBe("content_item")
		expect(getTableName(contentVersions)).toBe("content_version")
		expect(getTableName(relatedLinks)).toBe("related_link")
		expect(Object.keys(getTableColumns(contentItems))).toEqual([
			"id",
			"contentType",
			"status",
			"currentWorkingVersionId",
			"currentPublishedVersionId",
			"createdBy",
			"lastEditedBy",
			"createdAt",
			"updatedAt",
		])
		expect(Object.keys(getTableColumns(contentVersions))).toEqual([
			"id",
			"itemId",
			"versionNo",
			"parentVersionId",
			"status",
			"contentType",
			"title",
			"summary",
			"body",
			"seriesCode",
			"denominationCode",
			"primaryUrl",
			"createdBy",
			"createdAt",
			"approvedBy",
			"approvedAt",
			"publishedBy",
			"publishedAt",
		])
		expect(Object.keys(getTableColumns(relatedLinks))).toEqual([
			"id",
			"contentVersionId",
			"position",
			"kind",
			"label",
			"externalUrl",
			"internalRoute",
			"targetContentItemId",
			"createdAt",
		])

		const itemChecks = getTableConfig(contentItems).checks.map(item => item.name)
		expect(itemChecks).toEqual(
			expect.arrayContaining(["content_item_type_check", "content_item_status_check"])
		)
		const versionChecks = getTableConfig(contentVersions).checks.map(item => item.name)
		expect(versionChecks).toEqual(
			expect.arrayContaining([
				"content_version_number_check",
				"content_version_type_check",
				"content_version_status_check",
				"content_version_fields_check",
				"content_version_approval_fields_check",
				"content_version_publication_fields_check",
				"content_version_lifecycle_fields_check",
			])
		)
		expect(getTableConfig(relatedLinks).checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"related_link_kind_check",
				"related_link_position_check",
				"related_link_target_check",
			])
		)
		expect(schema.contentItems.table).toBe(contentItems)
		expect(schema.contentVersions.table).toBe(contentVersions)
		expect(schema.relatedLinks.table).toBe(relatedLinks)
	})
})

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
