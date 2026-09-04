import { getTableColumns, getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import {
	analyticsEvents,
	consentRecords,
	contentBundleBlobs,
	contentBundleChannels,
	contentBundleManifestEntries,
	contentBundleRebuildRequests,
	contentBundles,
	contentItems,
	contentVersions,
	idempotencyKeys,
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

describe("AN-1 analytics event database schema", () => {
	it("persists only the closed, pseudonymous analytics envelope", () => {
		expect(getTableName(analyticsEvents)).toBe("analytics_event")
		const prohibitedColumns = [
			"accountId",
			"account_id",
			"email",
			"name",
			"ipAddress",
			"ip_address",
			"userAgent",
			"user_agent",
			"image",
			"token",
			"cookie",
			"authorization",
		]
		expect(
			Object.keys(getTableColumns(analyticsEvents)).filter(column =>
				prohibitedColumns.includes(column)
			)
		).toEqual([])
		expect(Object.keys(getTableColumns(analyticsEvents))).toEqual([
			"eventId",
			"schemaVersion",
			"eventName",
			"occurredAt",
			"subjectPseudoId",
			"sessionId",
			"accountType",
			"screen",
			"feature",
			"appVersion",
			"osName",
			"osVersion",
			"deviceCategory",
			"networkState",
			"status",
			"properties",
			"receivedAt",
		])

		const config = getTableConfig(analyticsEvents)
		expect(getTableColumns(analyticsEvents).eventId.primary).toBe(true)
		expect(config.checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"analytics_event_schema_version_check",
				"analytics_event_name_check",
				"analytics_event_subject_pseudo_id_check",
				"analytics_event_account_type_check",
				"analytics_event_catalog_check",
				"analytics_event_app_version_check",
				"analytics_event_os_name_check",
				"analytics_event_os_version_check",
				"analytics_event_device_category_check",
				"analytics_event_network_state_check",
				"analytics_event_status_check",
				"analytics_event_properties_object_check",
			])
		)
		expect(config.indexes.map(item => item.config.name)).toEqual(
			expect.arrayContaining([
				"analytics_event_name_occurred_at_idx",
				"analytics_event_subject_occurred_at_idx",
				"analytics_event_session_occurred_at_idx",
			])
		)
		expect(schema.analyticsEvents.table).toBe(analyticsEvents)
	})
})

describe("CE-1 offline currency bundle database schema", () => {
	it("defines durable bundles with generated versions and bounded signed envelope metadata", () => {
		expect(getTableName(contentBundles)).toBe("content_bundle")
		expect(Object.keys(getTableColumns(contentBundles))).toEqual([
			"id",
			"version",
			"state",
			"schemaVersion",
			"manifestPayload",
			"manifestSha256",
			"algorithm",
			"keyId",
			"signature",
			"entryCount",
			"coreByteLength",
			"failureCode",
			"createdAt",
			"readyAt",
			"failedAt",
		])
		const config = getTableConfig(contentBundles)
		expect(config.uniqueConstraints.map(item => item.name)).toContain(
			"content_bundle_version_unique"
		)
		expect(config.checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"content_bundle_version_check",
				"content_bundle_state_check",
				"content_bundle_schema_version_check",
				"content_bundle_size_check",
				"content_bundle_envelope_check",
				"content_bundle_lifecycle_check",
			])
		)
		expect(config.indexes.map(item => item.config.name)).toContain(
			"content_bundle_ready_version_idx"
		)
		expect(schema.contentBundles.table).toBe(contentBundles)
	})

	it("defines immutable content-addressed blobs and deterministic manifest entries", () => {
		expect(getTableName(contentBundleBlobs)).toBe("content_bundle_blob")
		expect(Object.keys(getTableColumns(contentBundleBlobs))).toEqual([
			"sha256",
			"byteLength",
			"mediaType",
			"body",
			"createdAt",
		])
		expect(getTableName(contentBundleManifestEntries)).toBe("content_bundle_manifest_entry")
		expect(Object.keys(getTableColumns(contentBundleManifestEntries))).toEqual([
			"bundleId",
			"logicalId",
			"position",
			"kind",
			"delivery",
			"mediaType",
			"byteLength",
			"sha256",
			"downloadPath",
			"contentItemId",
			"contentVersionId",
		])

		const blobConfig = getTableConfig(contentBundleBlobs)
		expect(blobConfig.uniqueConstraints.map(item => item.name)).toContain(
			"content_bundle_blob_metadata_unique"
		)
		expect(blobConfig.checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"content_bundle_blob_sha256_check",
				"content_bundle_blob_size_check",
				"content_bundle_blob_media_type_check",
				"content_bundle_blob_body_length_check",
			])
		)

		const entryConfig = getTableConfig(contentBundleManifestEntries)
		expect(entryConfig.primaryKeys).toHaveLength(1)
		expect(entryConfig.uniqueConstraints.map(item => item.name)).toContain(
			"content_bundle_manifest_entry_bundle_position_unique"
		)
		expect(entryConfig.foreignKeys.map(item => item.getName())).toEqual(
			expect.arrayContaining([
				"content_bundle_manifest_entry_bundle_fkey",
				"content_bundle_manifest_entry_blob_metadata_fkey",
				"content_bundle_manifest_entry_content_item_version_fkey",
			])
		)
		expect(entryConfig.indexes.map(item => item.config.name)).toEqual(
			expect.arrayContaining([
				"content_bundle_manifest_entry_bundle_idx",
				"content_bundle_manifest_entry_content_trace_idx",
			])
		)
		expect(schema.contentBundleBlobs.table).toBe(contentBundleBlobs)
		expect(schema.contentBundleManifestEntries.table).toBe(contentBundleManifestEntries)
	})

	it("defines the singleton primary channel and recoverable rebuild lease metadata", () => {
		expect(getTableName(contentBundleChannels)).toBe("content_bundle_channel")
		expect(Object.keys(getTableColumns(contentBundleChannels))).toEqual([
			"id",
			"currentBundleId",
			"updatedAt",
		])
		expect(getTableConfig(contentBundleChannels).checks.map(item => item.name)).toContain(
			"content_bundle_channel_primary_check"
		)

		expect(Object.keys(getTableColumns(contentBundleRebuildRequests))).toEqual([
			"id",
			"itemId",
			"publishedVersionId",
			"reason",
			"state",
			"attemptCount",
			"availableAt",
			"lastAttemptAt",
			"leaseOwner",
			"leaseExpiresAt",
			"processedBundleId",
			"processedAt",
			"lastError",
			"createdAt",
		])
		const requestConfig = getTableConfig(contentBundleRebuildRequests)
		expect(requestConfig.foreignKeys.map(item => item.getName())).toContain(
			"content_bundle_rebuild_request_processed_bundle_fkey"
		)
		expect(requestConfig.indexes.map(item => item.config.name)).toEqual(
			expect.arrayContaining([
				"content_bundle_rebuild_request_poll_idx",
				"content_bundle_rebuild_request_lease_expiry_idx",
			])
		)
		expect(schema.contentBundleChannels.table).toBe(contentBundleChannels)
	})
})

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
			"bundlePending",
			"publishAt",
			"publishAtBy",
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
			"restoredFromVersionId",
			"status",
			"contentType",
			"title",
			"summary",
			"body",
			"seriesCode",
			"denominationCode",
			"primaryUrl",
			"featureLevel",
			"hotspotXPermille",
			"hotspotYPermille",
			"createdBy",
			"createdAt",
			"approvedBy",
			"approvedAt",
			"publishedBy",
			"publishedAt",
			"transitionAction",
			"transitionComments",
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

describe("CM-3 content workflow database schema", () => {
	it("stores only a nullable deterministic request fingerprint for idempotency replay binding", () => {
		expect(Object.keys(getTableColumns(idempotencyKeys))).toEqual([
			"key",
			"authorId",
			"requestFingerprint",
			"response",
			"createdAt",
			"expiresAt",
		])
		expect(getTableConfig(idempotencyKeys).checks.map(item => item.name)).toContain(
			"idempotency_keys_request_fingerprint_check"
		)
	})

	it("adds immutable transition metadata and bundle invalidation state", () => {
		expect(Object.keys(getTableColumns(contentItems))).toContain("bundlePending")
		expect(Object.keys(getTableColumns(contentVersions))).toEqual(
			expect.arrayContaining(["transitionAction", "transitionComments"])
		)
		expect(getTableConfig(contentVersions).checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"content_version_transition_action_check",
				"content_version_transition_comments_check",
				"content_version_transition_lifecycle_check",
			])
		)
	})

	it("defines the durable rebuild outbox with ownership, retry checks, and polling indexes", () => {
		const outbox = contentBundleRebuildRequests

		expect(getTableName(outbox)).toBe("content_bundle_rebuild_request")
		expect(Object.keys(getTableColumns(outbox))).toEqual([
			"id",
			"itemId",
			"publishedVersionId",
			"reason",
			"state",
			"attemptCount",
			"availableAt",
			"lastAttemptAt",
			"leaseOwner",
			"leaseExpiresAt",
			"processedBundleId",
			"processedAt",
			"lastError",
			"createdAt",
		])
		const config = getTableConfig(outbox)
		expect(config.foreignKeys.map(item => item.getName())).toContain(
			"content_bundle_rebuild_request_item_version_fkey"
		)
		expect(config.uniqueConstraints.map(item => item.name)).toContain(
			"content_bundle_rebuild_request_published_version_unique"
		)
		expect(config.checks.map(item => item.name)).toEqual(
			expect.arrayContaining([
				"content_bundle_rebuild_request_state_check",
				"content_bundle_rebuild_request_attempt_count_check",
				"content_bundle_rebuild_request_last_error_check",
				"content_bundle_rebuild_request_delivery_metadata_check",
			])
		)
		expect(config.indexes.map(item => item.config.name)).toEqual(
			expect.arrayContaining([
				"content_bundle_rebuild_request_poll_idx",
				"content_bundle_rebuild_request_item_created_idx",
			])
		)
		expect(schema.contentBundleRebuildRequests.table).toBe(outbox)
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
