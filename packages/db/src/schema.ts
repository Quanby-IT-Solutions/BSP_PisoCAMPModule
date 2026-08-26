import { defineRelations, sql } from "drizzle-orm"
import { check, foreignKey, index, primaryKey, unique } from "drizzle-orm/pg-core"

import type { PisoCampContentStatus, PisoCampContentType } from "@repo/contracts"

import { createTable } from "./utils/table.js"

// ============================================================================
// BETTER AUTH TABLES
// ============================================================================

export const users = createTable("users", t => ({
	id: t.text("id").primaryKey(),
	name: t.text("name").notNull(),
	email: t.text("email").notNull().unique(),
	emailVerified: t.boolean("email_verified").default(false).notNull(),
	image: t.text("image"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const sessions = createTable("sessions", t => ({
	id: t.text("id").primaryKey(),
	token: t.text("token").notNull().unique(),
	userId: t
		.text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	expiresAt: t.timestamp("expires_at").notNull(),
	ipAddress: t.text("ip_address"),
	userAgent: t.text("user_agent"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const accounts = createTable(
	"accounts",
	t => ({
		id: t.text("id"),
		accountId: t.text("account_id").notNull(),
		providerId: t.text("provider_id").notNull(),
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		accessToken: t.text("access_token"),
		refreshToken: t.text("refresh_token"),
		idToken: t.text("id_token"),
		accessTokenExpiresAt: t.timestamp("access_token_expires_at"),
		refreshTokenExpiresAt: t.timestamp("refresh_token_expires_at"),
		scope: t.text("scope"),
		password: t.text("password"), // For email/password auth
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [
		// Composite primary key on provider and account
		primaryKey({ columns: [t.providerId, t.accountId] }),
		index("account_user_id_idx").on(t.userId),
	]
)

export const verifications = createTable(
	"verifications",
	t => ({
		id: t.text("id"),
		identifier: t.text("identifier").notNull(),
		value: t.text("value").notNull(),
		expiresAt: t.timestamp("expires_at").notNull(),
		createdAt: t.timestamp("created_at").defaultNow(),
		updatedAt: t.timestamp("updated_at").defaultNow(),
	}),
	t => [
		// Composite primary key on identifier and value
		primaryKey({ columns: [t.identifier, t.value] }),
		// HY-2 / F-40. Rows here are short-lived tokens, but nothing deleted them,
		// so the table only ever grew — every unverified signup and every password
		// reset, kept forever. The sweeper deletes by expiry; without this index it
		// seq-scans a table whose whole problem is that it is large.
		index("verifications_expires_at_idx").on(t.expiresAt),
	]
)

// ============================================================================
// TODOs
// ============================================================================

export const todos = createTable("todos", t => ({
	id: t.serial("id").primaryKey(),
	title: t.text("title").notNull(),
	completed: t.boolean("completed").notNull().default(false),
	authorId: t
		.text("author_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

// ============================================================================
// TICKETS
// ============================================================================

export const tickets = createTable("tickets", t => ({
	id: t.serial("id").primaryKey(),
	name: t.text("name").notNull(),
	email: t.text("email").notNull(),
	subject: t.text("subject").notNull(),
	priority: t
		.text("priority")
		.notNull()
		.default("medium")
		.$type<"low" | "medium" | "high" | "urgent">(),
	concern: t.text("concern").notNull(),
	status: t
		.text("status")
		.notNull()
		.default("received")
		.$type<"received" | "in_progress" | "resolved" | "closed">(),
	authorId: t.text("author_id").references(() => users.id, { onDelete: "set null" }),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

// ============================================================================
// IDEMPOTENCY KEYS
// ============================================================================

/**
 * Replay cache for mutating requests (AB-3 / F-13).
 *
 * The primary key is composite on `(authorId, key)`. It used to be `key`
 * alone, which made the keyspace global: whoever sent a value first owned it,
 * so one user could squat another's key and the second user's request was
 * rejected as a duplicate — a denial-of-service against any client using
 * predictable keys. Idempotency is identity-scoped by design; two users
 * sending the same key are sending two unrelated requests.
 *
 * This is a cache, not a record. Rows expire and are swept.
 */
export const idempotencyKeys = createTable(
	"idempotency_keys",
	t => ({
		key: t.text("key").notNull(),
		authorId: t.text("author_id").notNull(),
		response: t.jsonb("response").notNull().$type<unknown>(),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		/** When this row stops being a valid replay target. */
		expiresAt: t.timestamp("expires_at").notNull(),
	}),
	t => [
		primaryKey({ columns: [t.authorId, t.key] }),
		// The sweeper deletes by expiry; without this it seq-scans the table.
		index("idempotency_keys_expires_at_idx").on(t.expiresAt),
	]
)

// ============================================================================
// RBAC
// ============================================================================

export const roles = createTable("roles", t => ({
	id: t.serial("id").primaryKey(),
	name: t.text("name").notNull().unique(),
	description: t.text("description"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const permissions = createTable("permissions", t => ({
	id: t.serial("id").primaryKey(),
	name: t.text("name").notNull().unique(),
	description: t.text("description"),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const userRoles = createTable(
	"user_roles",
	t => ({
		userId: t
			.text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		roleId: t
			.integer("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
	}),
	t => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_user_id_idx").on(t.userId)]
)

export const rolePermissions = createTable(
	"role_permissions",
	t => ({
		roleId: t
			.integer("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
		permissionId: t
			.integer("permission_id")
			.notNull()
			.references(() => permissions.id, { onDelete: "cascade" }),
	}),
	t => [primaryKey({ columns: [t.roleId, t.permissionId] })]
)

// ============================================================================
// PISO CAMP ADMINISTRATION
// ============================================================================

export const moduleConfiguration = createTable("module_configuration", t => ({
	key: t.text("key").primaryKey(),
	value: t.jsonb("value").notNull().$type<unknown>(),
	updatedBy: t.text("updated_by").references(() => users.id, { onDelete: "set null" }),
	createdAt: t.timestamp("created_at").notNull().defaultNow(),
	updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
}))

export const pisoCampAccountState = createTable(
	"pisocamp_account_state",
	t => ({
		accountId: t
			.text("account_id")
			.primaryKey()
			.references(() => users.id, { onDelete: "cascade" }),
		status: t.text("status").notNull().default("active").$type<"active" | "deactivated">(),
		reason: t.text("reason"),
		updatedBy: t.text("updated_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at").notNull().defaultNow(),
	}),
	t => [check("pisocamp_account_state_status_check", sql`${t.status} in ('active', 'deactivated')`)]
)

// ============================================================================
// PISO CAMP PRIVACY NOTICE AND CONSENT
// ============================================================================

/** Approved, immutable notice versions. F4 exposes no UPDATE or DELETE path. */
export const privacyNotices = createTable(
	"privacy_notice",
	t => ({
		id: t.uuid("id").primaryKey(),
		version: t.text("version").notNull().unique(),
		title: t.text("title").notNull(),
		body: t.text("body").notNull(),
		sourceUrl: t.text("source_url").notNull(),
		contentSha256: t.text("content_sha256").notNull(),
		effectiveAt: t.timestamp("effective_at", { withTimezone: true }).notNull(),
		createdAt: t.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		unique("privacy_notice_id_version_unique").on(t.id, t.version),
		check("privacy_notice_content_sha256_check", sql`${t.contentSha256} ~ '^[a-f0-9]{64}$'`),
	]
)

/** Append-only consent evidence. Current/reconsent state is derived, never updated here. */
export const consentRecords = createTable(
	"consent_record",
	t => ({
		id: t.uuid("id").primaryKey(),
		accountId: t.text("account_id").references(() => users.id, { onDelete: "restrict" }),
		devicePseudoId: t.text("device_pseudo_id"),
		purpose: t
			.text("purpose")
			.notNull()
			.$type<"registration" | "survey" | "demographic_analytics">(),
		noticeId: t.uuid("notice_id").notNull(),
		noticeVersion: t.text("notice_version").notNull(),
		status: t.text("status").notNull().$type<"granted" | "declined" | "withdrawn">(),
		respondedAt: t.timestamp("responded_at", { withTimezone: true }).notNull(),
		recordedAt: t.timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		foreignKey({
			columns: [t.noticeId, t.noticeVersion],
			foreignColumns: [privacyNotices.id, privacyNotices.version],
			name: "consent_record_notice_id_version_fkey",
		}).onDelete("restrict"),
		check(
			"consent_record_subject_xor_check",
			sql`(${t.accountId} is not null) <> (${t.devicePseudoId} is not null)`
		),
		check(
			"consent_record_device_pseudo_id_check",
			sql`${t.devicePseudoId} is null or ${t.devicePseudoId} ~ '^[A-Za-z0-9_-]{22}$'`
		),
		check(
			"consent_record_purpose_check",
			sql`${t.purpose} in ('registration', 'survey', 'demographic_analytics')`
		),
		check("consent_record_status_check", sql`${t.status} in ('granted', 'declined', 'withdrawn')`),
		index("consent_record_account_purpose_recorded_idx")
			.on(t.accountId, t.purpose, t.recordedAt.desc())
			.where(sql`${t.accountId} is not null`),
		index("consent_record_device_purpose_recorded_idx")
			.on(t.devicePseudoId, t.purpose, t.recordedAt.desc())
			.where(sql`${t.devicePseudoId} is not null`),
	]
)

// ============================================================================
// PISO CAMP PROFILE AND FROZEN PSGC CATALOG
// ============================================================================

export const pisoCampRegions = createTable("region", t => ({
	code: t.text("code").primaryKey(),
	name: t.text("name").notNull(),
	catalogVersion: t.text("catalog_version").notNull(),
}))

export const pisoCampCities = createTable(
	"city",
	t => ({
		code: t.text("code").primaryKey(),
		regionCode: t
			.text("region_code")
			.notNull()
			.references(() => pisoCampRegions.code, { onDelete: "restrict" }),
		name: t.text("name").notNull(),
		catalogVersion: t.text("catalog_version").notNull(),
	}),
	t => [
		unique("city_code_region_unique").on(t.code, t.regionCode),
		index("city_region_name_idx").on(t.regionCode, t.name),
	]
)

export const pisoCampProfiles = createTable(
	"piso_camp_profile",
	t => ({
		accountId: t
			.text("account_id")
			.primaryKey()
			.references(() => users.id, { onDelete: "cascade" }),
		gender: t.text("gender").notNull().$type<"female" | "male" | "prefer_not_to_say">(),
		age: t.integer("age").notNull(),
		regionCode: t
			.text("region_code")
			.notNull()
			.references(() => pisoCampRegions.code, { onDelete: "restrict" }),
		cityCode: t.text("city_code").notNull(),
		registrationConsentRecordId: t
			.uuid("registration_consent_record_id")
			.notNull()
			.references(() => consentRecords.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		foreignKey({
			columns: [t.cityCode, t.regionCode],
			foreignColumns: [pisoCampCities.code, pisoCampCities.regionCode],
			name: "piso_camp_profile_city_region_fkey",
		}).onDelete("restrict"),
		check(
			"piso_camp_profile_gender_check",
			sql`${t.gender} in ('female', 'male', 'prefer_not_to_say')`
		),
		check("piso_camp_profile_age_check", sql`${t.age} between 1 and 120`),
	]
)

export const pisoCampDeviceAccountLinks = createTable(
	"piso_camp_device_account_link",
	t => ({
		devicePseudoId: t.text("device_pseudo_id").primaryKey(),
		accountId: t
			.text("account_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		registrationConsentRecordId: t
			.uuid("registration_consent_record_id")
			.notNull()
			.unique()
			.references(() => consentRecords.id, { onDelete: "restrict" }),
		linkedAt: t.timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		check(
			"piso_camp_device_account_link_device_check",
			sql`${t.devicePseudoId} ~ '^[A-Za-z0-9_-]{22}$'`
		),
		index("piso_camp_device_account_link_account_idx").on(t.accountId),
	]
)

// ============================================================================
// PISO CAMP CONTENT FOUNDATION AND FROZEN CURRENCY CATALOG
// ============================================================================

export const pisoCampCurrencySeries = createTable(
	"piso_camp_currency_series",
	t => ({
		code: t.text("code").primaryKey(),
		name: t.text("name").notNull(),
		mediaKind: t.text("media_kind").notNull().$type<"banknote" | "coin">(),
		sourceUrl: t.text("source_url").notNull(),
		catalogVersion: t.text("catalog_version").notNull(),
	}),
	t => [
		unique("piso_camp_currency_series_code_media_kind_unique").on(t.code, t.mediaKind),
		check(
			"piso_camp_currency_series_media_kind_check",
			sql`${t.mediaKind} in ('banknote', 'coin')`
		),
		check("piso_camp_currency_series_source_url_check", sql`${t.sourceUrl} ~ '^https://'`),
	]
)

export const pisoCampCurrencyDenominations = createTable(
	"piso_camp_currency_denomination",
	t => ({
		seriesCode: t
			.text("series_code")
			.notNull()
			.references(() => pisoCampCurrencySeries.code, { onDelete: "restrict" }),
		code: t.text("code").notNull(),
		minorUnitValue: t.integer("minor_unit_value").notNull(),
		label: t.text("label").notNull(),
		sortOrder: t.integer("sort_order").notNull(),
	}),
	t => [
		primaryKey({ columns: [t.seriesCode, t.code] }),
		unique("piso_camp_currency_denomination_series_sort_unique").on(t.seriesCode, t.sortOrder),
		check("piso_camp_currency_denomination_minor_unit_value_check", sql`${t.minorUnitValue} > 0`),
		check("piso_camp_currency_denomination_sort_order_check", sql`${t.sortOrder} >= 0`),
	]
)

export const contentItems = createTable(
	"content_item",
	t => ({
		id: t.uuid("id").primaryKey().defaultRandom(),
		contentType: t.text("content_type").notNull().$type<PisoCampContentType>(),
		status: t.text("status").notNull().default("draft").$type<PisoCampContentStatus>(),
		currentWorkingVersionId: t.uuid("current_working_version_id"),
		currentPublishedVersionId: t.uuid("current_published_version_id"),
		createdBy: t
			.text("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		lastEditedBy: t
			.text("last_edited_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: t.timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		unique("content_item_id_type_unique").on(t.id, t.contentType),
		check(
			"content_item_type_check",
			sql`${t.contentType} in ('banknote', 'coin', 'security_feature', 'advisory', 'link')`
		),
		check(
			"content_item_status_check",
			sql`${t.status} in ('draft', 'submitted_for_review', 'approved', 'published', 'unpublished', 'deactivated', 'archived')`
		),
		index("content_item_list_idx").on(t.status, t.contentType, t.updatedAt.desc()),
		index("content_item_created_by_idx").on(t.createdBy, t.createdAt.desc()),
	]
)

export const contentVersions = createTable(
	"content_version",
	t => ({
		id: t.uuid("id").primaryKey().defaultRandom(),
		itemId: t
			.uuid("item_id")
			.notNull()
			.references(() => contentItems.id, { onDelete: "restrict" }),
		versionNo: t.integer("version_no").notNull(),
		parentVersionId: t.uuid("parent_version_id"),
		status: t.text("status").notNull().$type<PisoCampContentStatus>(),
		contentType: t.text("content_type").notNull().$type<PisoCampContentType>(),
		title: t.text("title").notNull(),
		summary: t.text("summary").notNull(),
		body: t.text("body"),
		seriesCode: t.text("series_code"),
		denominationCode: t.text("denomination_code"),
		primaryUrl: t.text("primary_url"),
		createdBy: t
			.text("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		approvedBy: t.text("approved_by").references(() => users.id, { onDelete: "restrict" }),
		approvedAt: t.timestamp("approved_at", { withTimezone: true }),
		publishedBy: t.text("published_by").references(() => users.id, { onDelete: "restrict" }),
		publishedAt: t.timestamp("published_at", { withTimezone: true }),
	}),
	t => [
		unique("content_version_item_version_no_unique").on(t.itemId, t.versionNo),
		unique("content_version_item_id_id_unique").on(t.itemId, t.id),
		foreignKey({
			columns: [t.itemId, t.contentType],
			foreignColumns: [contentItems.id, contentItems.contentType],
			name: "content_version_item_type_fkey",
		}).onDelete("restrict"),
		foreignKey({
			columns: [t.seriesCode, t.denominationCode],
			foreignColumns: [
				pisoCampCurrencyDenominations.seriesCode,
				pisoCampCurrencyDenominations.code,
			],
			name: "content_version_currency_denomination_fkey",
		}).onDelete("restrict"),
		check("content_version_number_check", sql`${t.versionNo} > 0`),
		check(
			"content_version_type_check",
			sql`${t.contentType} in ('banknote', 'coin', 'security_feature', 'advisory', 'link')`
		),
		check(
			"content_version_status_check",
			sql`${t.status} in ('draft', 'submitted_for_review', 'approved', 'published', 'unpublished', 'deactivated', 'archived')`
		),
		check(
			"content_version_fields_check",
			sql`(
				(${t.contentType} = 'banknote' and ${t.seriesCode} in ('fpp-banknotes', 'engc-banknotes', 'ngc-banknotes') and ${t.denominationCode} is not null and ${t.body} is not null and char_length(${t.body}) between 1 and 10000 and ${t.primaryUrl} is null)
				or (${t.contentType} = 'coin' and ${t.seriesCode} in ('ngc-coins', 'bsp-coin-series') and ${t.denominationCode} is not null and ${t.body} is not null and char_length(${t.body}) between 1 and 10000 and ${t.primaryUrl} is null)
				or (${t.contentType} = 'security_feature' and ${t.seriesCode} is not null and ${t.denominationCode} is not null and ${t.body} is not null and char_length(${t.body}) between 1 and 10000 and ${t.primaryUrl} is null)
				or (${t.contentType} = 'advisory' and ${t.seriesCode} is null and ${t.denominationCode} is null and ${t.body} is not null and char_length(${t.body}) between 1 and 10000 and ${t.primaryUrl} is null)
				or (${t.contentType} = 'link' and ${t.seriesCode} is null and ${t.denominationCode} is null and ${t.primaryUrl} is not null)
			)`
		),
		check(
			"content_version_common_text_check",
			sql`${t.title} = btrim(${t.title}) and char_length(${t.title}) between 1 and 160 and ${t.title} !~ '<!--|</?[A-Za-z]|<!|<\\?' and ${t.summary} = btrim(${t.summary}) and char_length(${t.summary}) between 1 and 500 and ${t.summary} !~ '<!--|</?[A-Za-z]|<!|<\\?' and (${t.body} is null or (${t.body} = btrim(${t.body}) and char_length(${t.body}) between 0 and 10000 and ${t.body} !~ '<!--|</?[A-Za-z]|<!|<\\?'))`
		),
		check(
			"content_version_primary_url_check",
			sql`${t.primaryUrl} is null or (${t.primaryUrl} = btrim(${t.primaryUrl}) and char_length(${t.primaryUrl}) <= 2048 and ${t.primaryUrl} ~ '^https://[^[:space:]]+$')`
		),
		check(
			"content_version_approval_fields_check",
			sql`(${t.approvedBy} is null) = (${t.approvedAt} is null)`
		),
		check(
			"content_version_publication_fields_check",
			sql`(${t.publishedBy} is null) = (${t.publishedAt} is null)`
		),
		check(
			"content_version_lifecycle_fields_check",
			sql`(
				(${t.status} in ('draft', 'submitted_for_review') and ${t.approvedBy} is null and ${t.approvedAt} is null and ${t.publishedBy} is null and ${t.publishedAt} is null)
				or (${t.status} = 'approved' and ${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.publishedBy} is null and ${t.publishedAt} is null)
				or (${t.status} in ('published', 'unpublished', 'deactivated', 'archived') and ${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.publishedBy} is not null and ${t.publishedAt} is not null)
			)`
		),
		index("content_version_item_created_idx").on(t.itemId, t.createdAt.desc()),
		index("content_version_currency_idx").on(t.seriesCode, t.denominationCode),
		index("content_version_created_by_idx").on(t.createdBy, t.createdAt.desc()),
		index("content_version_search_idx").using(
			"gin",
			sql`to_tsvector('simple', ${t.title} || ' ' || ${t.summary})`
		),
	]
)

export const relatedLinks = createTable(
	"related_link",
	t => ({
		id: t.uuid("id").primaryKey().defaultRandom(),
		contentVersionId: t
			.uuid("content_version_id")
			.notNull()
			.references(() => contentVersions.id, { onDelete: "restrict" }),
		position: t.integer("position").notNull(),
		kind: t.text("kind").notNull().$type<"external" | "internal" | "topic">(),
		label: t.text("label").notNull(),
		externalUrl: t.text("external_url"),
		internalRoute: t.text("internal_route"),
		targetContentItemId: t
			.uuid("target_content_item_id")
			.references(() => contentItems.id, { onDelete: "restrict" }),
		createdAt: t.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	}),
	t => [
		unique("related_link_version_position_unique").on(t.contentVersionId, t.position),
		check("related_link_position_check", sql`${t.position} between 0 and 9`),
		check("related_link_kind_check", sql`${t.kind} in ('external', 'internal', 'topic')`),
		check(
			"related_link_label_check",
			sql`${t.label} = btrim(${t.label}) and char_length(${t.label}) between 1 and 100 and ${t.label} !~ '<!--|</?[A-Za-z]|<!|<\\?'`
		),
		check(
			"related_link_target_check",
			sql`(
				(${t.kind} = 'external' and ${t.externalUrl} is not null and ${t.internalRoute} is null and ${t.targetContentItemId} is null)
				or (${t.kind} = 'internal' and ${t.externalUrl} is null and ${t.internalRoute} is not null and ${t.targetContentItemId} is null)
				or (${t.kind} = 'topic' and ${t.externalUrl} is null and ${t.internalRoute} is null and ${t.targetContentItemId} is not null)
			)`
		),
		check(
			"related_link_external_url_check",
			sql`${t.externalUrl} is null or (${t.externalUrl} = btrim(${t.externalUrl}) and char_length(${t.externalUrl}) <= 2048 and ${t.externalUrl} ~ '^https://[^[:space:]]+$')`
		),
		check(
			"related_link_internal_route_check",
			sql`${t.internalRoute} is null or (char_length(${t.internalRoute}) <= 512 and ${t.internalRoute} ~ '^/[a-z0-9]+([a-z0-9-]*[a-z0-9])?(/[a-z0-9]+([a-z0-9-]*[a-z0-9])?)*$')`
		),
		index("related_link_topic_target_idx").on(t.targetContentItemId),
	]
)

// ============================================================================
// AUDIT LOG
// ============================================================================

/**
 * Append-only record of privileged mutations (AZ-4 / F-17).
 *
 * Owned by the `authz` epic. Rows are written **in the same transaction** as
 * the mutation they describe, so a failed insert rolls the mutation back and
 * the log can never disagree with the data. Other domains record events by
 * calling the audit service's helper — never by inserting here directly — so
 * that the append-only rule has exactly one enforcement point.
 *
 * There is deliberately no `updatedAt`: a row that can be updated is not an
 * audit trail. The application exposes no UPDATE or DELETE path to this table.
 *
 * `actorId` is nullable and uses `set null` rather than `cascade`: deleting a
 * user must never erase the record of what they did.
 */
export const auditLog = createTable(
	"audit_log",
	t => ({
		id: t.serial("id").primaryKey(),
		/** Broad area the event belongs to, e.g. "rbac". Kept generic so auth
		 *  events can adopt this table without a schema change. */
		domain: t.text("domain").notNull(),
		/** What happened, e.g. "role.assign", "role.remove", "role.create". */
		action: t.text("action").notNull(),
		/** Whether the attempt succeeded or was refused. A denial is evidence. */
		outcome: t.text("outcome").notNull().default("success").$type<"success" | "denied">(),
		/** Who acted. Null only for system-initiated events. */
		actorId: t.text("actor_id").references(() => users.id, { onDelete: "set null" }),
		/** Kind of thing acted on, e.g. "user", "role". */
		targetType: t.text("target_type"),
		/** Identifier of the thing acted on, as text so any key type fits. */
		targetId: t.text("target_id"),
		/** State before and after, plus any denial reason. Shape is per-action. */
		oldValue: t.jsonb("old_value").$type<unknown>(),
		newValue: t.jsonb("new_value").$type<unknown>(),
		reason: t.text("reason"),
		createdAt: t.timestamp("created_at").notNull().defaultNow(),
	}),
	t => [
		// The read endpoint is strictly reverse-chronological.
		index("audit_log_created_at_idx").on(t.createdAt),
		index("audit_log_actor_id_idx").on(t.actorId),
	]
)

// ============================================================================
// RELATIONS
// ============================================================================
export const relations = defineRelations(
	{
		users,
		sessions,
		accounts,
		todos,
		tickets,
		idempotencyKeys,
		roles,
		permissions,
		userRoles,
		rolePermissions,
		moduleConfiguration,
		pisoCampAccountState,
		privacyNotices,
		consentRecords,
		pisoCampRegions,
		pisoCampCities,
		pisoCampProfiles,
		pisoCampDeviceAccountLinks,
		pisoCampCurrencySeries,
		pisoCampCurrencyDenominations,
		contentItems,
		contentVersions,
		relatedLinks,
		auditLog,
	},
	r => ({
		users: {
			sessions: r.many.sessions(),
			accounts: r.many.accounts(),
			userRoles: r.many.userRoles(),
			moduleConfigurationsUpdated: r.many.moduleConfiguration({ alias: "configUpdater" }),
			pisoCampAccountState: r.one.pisoCampAccountState({
				from: r.users.id,
				to: r.pisoCampAccountState.accountId,
				alias: "accountStateAccount",
			}),
			pisoCampAccountStatesUpdated: r.many.pisoCampAccountState({ alias: "accountStateUpdater" }),
			consentRecords: r.many.consentRecords(),
			contentItemsCreated: r.many.contentItems({ alias: "contentItemCreator" }),
			contentItemsEdited: r.many.contentItems({ alias: "contentItemEditor" }),
			contentVersionsCreated: r.many.contentVersions({ alias: "contentVersionCreator" }),
		},
		sessions: {
			user: r.one.users({
				from: r.sessions.userId,
				to: r.users.id,
			}),
		},
		accounts: {
			user: r.one.users({
				from: r.accounts.userId,
				to: r.users.id,
			}),
		},
		todos: {
			author: r.one.users({
				from: r.todos.authorId,
				to: r.users.id,
			}),
		},
		tickets: {
			author: r.one.users({
				from: r.tickets.authorId,
				to: r.users.id,
			}),
		},
		roles: {
			userRoles: r.many.userRoles(),
			rolePermissions: r.many.rolePermissions(),
		},
		permissions: {
			rolePermissions: r.many.rolePermissions(),
		},
		auditLog: {
			actor: r.one.users({
				from: r.auditLog.actorId,
				to: r.users.id,
			}),
		},
		userRoles: {
			user: r.one.users({
				from: r.userRoles.userId,
				to: r.users.id,
			}),
			role: r.one.roles({
				from: r.userRoles.roleId,
				to: r.roles.id,
			}),
		},
		rolePermissions: {
			role: r.one.roles({
				from: r.rolePermissions.roleId,
				to: r.roles.id,
			}),
			permission: r.one.permissions({
				from: r.rolePermissions.permissionId,
				to: r.permissions.id,
			}),
		},
		moduleConfiguration: {
			updatedByUser: r.one.users({
				from: r.moduleConfiguration.updatedBy,
				to: r.users.id,
				alias: "configUpdater",
			}),
		},
		pisoCampAccountState: {
			account: r.one.users({
				from: r.pisoCampAccountState.accountId,
				to: r.users.id,
				alias: "accountStateAccount",
			}),
			updatedByUser: r.one.users({
				from: r.pisoCampAccountState.updatedBy,
				to: r.users.id,
				alias: "accountStateUpdater",
			}),
		},
		privacyNotices: {
			consentRecords: r.many.consentRecords(),
		},
		consentRecords: {
			account: r.one.users({
				from: r.consentRecords.accountId,
				to: r.users.id,
			}),
			notice: r.one.privacyNotices({
				from: [r.consentRecords.noticeId, r.consentRecords.noticeVersion],
				to: [r.privacyNotices.id, r.privacyNotices.version],
			}),
		},
		pisoCampCurrencySeries: {
			denominations: r.many.pisoCampCurrencyDenominations(),
		},
		pisoCampCurrencyDenominations: {
			series: r.one.pisoCampCurrencySeries({
				from: r.pisoCampCurrencyDenominations.seriesCode,
				to: r.pisoCampCurrencySeries.code,
			}),
			contentVersions: r.many.contentVersions(),
		},
		contentItems: {
			creator: r.one.users({
				from: r.contentItems.createdBy,
				to: r.users.id,
				alias: "contentItemCreator",
			}),
			lastEditor: r.one.users({
				from: r.contentItems.lastEditedBy,
				to: r.users.id,
				alias: "contentItemEditor",
			}),
			versions: r.many.contentVersions(),
			topicLinks: r.many.relatedLinks(),
		},
		contentVersions: {
			item: r.one.contentItems({
				from: r.contentVersions.itemId,
				to: r.contentItems.id,
			}),
			creator: r.one.users({
				from: r.contentVersions.createdBy,
				to: r.users.id,
				alias: "contentVersionCreator",
			}),
			currencyDenomination: r.one.pisoCampCurrencyDenominations({
				from: [r.contentVersions.seriesCode, r.contentVersions.denominationCode],
				to: [r.pisoCampCurrencyDenominations.seriesCode, r.pisoCampCurrencyDenominations.code],
			}),
			relatedLinks: r.many.relatedLinks(),
		},
		relatedLinks: {
			version: r.one.contentVersions({
				from: r.relatedLinks.contentVersionId,
				to: r.contentVersions.id,
			}),
			topicTarget: r.one.contentItems({
				from: r.relatedLinks.targetContentItemId,
				to: r.contentItems.id,
			}),
		},
	})
)

// ============================================================================
// SCHEMA
// ============================================================================
export const schema = Object.assign(
	{
		users,
		sessions,
		accounts,
		verifications,
		todos,
		tickets,
		idempotencyKeys,
		roles,
		permissions,
		userRoles,
		rolePermissions,
		moduleConfiguration,
		pisoCampAccountState,
		privacyNotices,
		consentRecords,
		pisoCampRegions,
		pisoCampCities,
		pisoCampProfiles,
		pisoCampDeviceAccountLinks,
		pisoCampCurrencySeries,
		pisoCampCurrencyDenominations,
		contentItems,
		contentVersions,
		relatedLinks,
		auditLog,
	},
	relations
)
