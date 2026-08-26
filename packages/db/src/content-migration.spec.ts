import "dotenv/config"

import { readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest"

const previousMigrationName = "20260824234024_f3_profile_foundation"
const migrationName = "20260825092716_cm1_content_foundation"
const databaseName = `cm1_content_migration_${process.pid}`
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const adminUrl = sourceUrl ? new URL(sourceUrl) : undefined
if (adminUrl) adminUrl.pathname = "/postgres"

const actorId = "cm1-content-migration-user"
const otherActorId = "cm1-content-migration-other-user"
const banknoteItemId = "2f86673f-220c-47f1-b4b8-3562f8074aaa"
const advisoryItemId = "41ba1366-39e5-4e76-8389-da485ae18bbb"
const linkItemId = "f0667c12-a930-48bb-95f6-0fbdb1a57fff"
const coinItemId = "988c6085-c182-4254-9308-7133be92a111"
const securityFeatureItemId = "1914bb92-7960-45f5-8410-7f6a5fe8a222"
const unversionedItemId = "27c3f763-340c-4bd8-a83b-aa0024c6cccc"
const banknoteVersionId = "b62ab44d-c173-4e18-b5c3-66fe4d8f4ddd"
const advisoryVersionId = "9ad237cf-0e75-46b2-a54e-383be9a85eee"

let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let unavailableReason = "PostgreSQL availability was not checked"

function isUnavailable(error: unknown): boolean {
	if (error instanceof AggregateError) return error.errors.some(isUnavailable)
	if (typeof error !== "object" || error === null || !("code" in error)) return false
	return new Set([
		"ECONNREFUSED",
		"ECONNRESET",
		"EHOSTUNREACH",
		"ENETUNREACH",
		"ENOTFOUND",
		"ETIMEDOUT",
		"53300",
		"57P03",
	]).has(String(error.code))
}

function requirePostgres(context: TestContext): pg.Pool {
	if (pool) return pool
	context.skip(`PostgreSQL unavailable: ${unavailableReason}`)
	throw new Error("Vitest context.skip returned unexpectedly")
}

async function expectRejected(
	activePool: pg.Pool,
	query: string,
	expected: RegExp | string,
	values: unknown[] = []
): Promise<void> {
	const client = await activePool.connect()
	let caught: unknown
	try {
		await client.query("begin")
		try {
			await client.query(query, values)
		} catch (error) {
			caught = error
		}
	} finally {
		await client.query("rollback")
		client.release()
	}
	expect(caught, "query must be rejected by PostgreSQL").toBeDefined()
	if (expected instanceof RegExp) {
		expect(String((caught as Error).message)).toMatch(expected)
	} else {
		expect((caught as { constraint?: string }).constraint).toBe(expected)
	}
}

async function expectAccepted(
	activePool: pg.Pool,
	query: string,
	values: unknown[] = []
): Promise<void> {
	const client = await activePool.connect()
	try {
		await client.query("begin")
		await expect(client.query(query, values)).resolves.toBeDefined()
	} finally {
		await client.query("rollback")
		client.release()
	}
}

beforeAll(async () => {
	if (!adminUrl || !sourceUrl) {
		unavailableReason = "DATABASE_URL is not set"
		if (process.env.CI === "true") throw new Error(`CM-1 migration tests require PostgreSQL in CI`)
		return
	}
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	try {
		await admin.connect()
	} catch (error) {
		if (!isUnavailable(error)) throw error
		await admin.end().catch(() => undefined)
		admin = undefined
		unavailableReason = `connection failed (${String((error as { code?: string }).code ?? "unknown")})`
		if (process.env.CI === "true") throw new Error(`CM-1 migration tests require PostgreSQL in CI`)
		return
	}
	const existing = await admin.query("select 1 from pg_database where datname = $1", [databaseName])
	if (existing.rowCount) throw new Error(`Refusing to reuse ${databaseName}`)
	await admin.query(`create database "${databaseName}"`)
	const databaseUrl = new URL(sourceUrl)
	databaseUrl.pathname = `/${databaseName}`
	pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 1 })
})

afterAll(async () => {
	await pool?.end()
	if (admin) {
		await admin.query(
			"select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
			[databaseName]
		)
		await admin.query(`drop database if exists "${databaseName}"`)
		await admin.end()
	}
})

describe.sequential("single additive CM-1 content migration", () => {
	it("keeps exactly one named CM-1 migration after F3", async () => {
		const names = (await readdir(migrationsFolder, { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && entry.name > previousMigrationName)
			.map(entry => entry.name)
		expect(names).toEqual([migrationName])
	})

	it("migrates a fresh database and supports migration reapply", async context => {
		const activePool = requirePostgres(context)
		const database = drizzle({ client: activePool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })
		await activePool.query(
			`insert into users (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'CM-1 User', 'cm1-user@example.test', true, now(), now()),
			        ($2, 'Other CM-1 User', 'cm1-other@example.test', true, now(), now())`,
			[actorId, otherActorId]
		)
	})

	it("rejects a current-version pointer owned by another item", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into content_item
			 (id, content_type, status, created_by, last_edited_by)
			 values ($1, 'banknote', 'draft', $3, $3),
			        ($2, 'advisory', 'draft', $3, $3),
			        ($4, 'link', 'draft', $3, $3),
			        ($5, 'coin', 'draft', $3, $3),
			        ($6, 'security_feature', 'draft', $3, $3)`,
			[banknoteItemId, advisoryItemId, actorId, linkItemId, coinItemId, securityFeatureItemId]
		)
		await activePool.query(
			`insert into content_version
			 (id, item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, $2, 1, 'draft', 'banknote', 'NGC 20', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $4),
			        ($3, $5, 1, 'draft', 'advisory', 'Advisory', 'Summary', 'Body',
			         null, null, $4)`,
			[banknoteVersionId, banknoteItemId, advisoryVersionId, actorId, advisoryItemId]
		)
		await activePool.query(
			"update content_item set current_working_version_id = $1 where id = $2",
			[banknoteVersionId, banknoteItemId]
		)
		await expectRejected(
			activePool,
			"update content_item set current_working_version_id = $1 where id = $2",
			"content_item_current_working_version_fkey",
			[advisoryVersionId, banknoteItemId]
		)
		await expectRejected(
			activePool,
			"update content_item set current_published_version_id = $1 where id = $2",
			"content_item_current_published_version_fkey",
			[advisoryVersionId, banknoteItemId]
		)
	})

	it("installs list, search, and audit lookup indexes", async context => {
		const activePool = requirePostgres(context)
		const indexes = await activePool.query<{ indexname: string }>(
			`select indexname from pg_indexes
			 where schemaname = 'public' and indexname in (
			   'content_item_list_idx', 'content_version_search_idx',
			   'content_version_created_by_idx', 'related_link_topic_target_idx'
			 ) order by indexname`
		)
		expect(indexes.rows.map(row => row.indexname)).toEqual([
			"content_item_list_idx",
			"content_version_created_by_idx",
			"content_version_search_idx",
			"related_link_topic_target_idx",
		])
	})

	it("installs the five series and 29 denominations exactly once", async context => {
		const activePool = requirePostgres(context)
		const counts = await activePool.query(
			`select (select count(*)::int from piso_camp_currency_series) series,
			        (select count(*)::int from piso_camp_currency_denomination) denominations,
			        (select count(*)::int from (
			           select series_code, code from piso_camp_currency_denomination
			           group by series_code, code
			        ) composite_keys) composite_keys`
		)
		expect(counts.rows[0]).toEqual({ series: 5, denominations: 29, composite_keys: 29 })
	})

	it("rejects invalid type, lifecycle, media-kind, and content-shape values", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			"insert into piso_camp_currency_series values ('bad', 'Bad', 'paper', 'https://www.bsp.gov.ph/', 'bad')",
			"piso_camp_currency_series_media_kind_check"
		)
		await expectRejected(
			activePool,
			"insert into piso_camp_currency_series values ('bad-url', 'Bad URL', 'coin', 'http://example.test', 'bad')",
			"piso_camp_currency_series_source_url_check"
		)
		await expectRejected(
			activePool,
			"insert into piso_camp_currency_denomination values ('ngc-coins', 'bad-value', 0, 'Bad', 90)",
			"piso_camp_currency_denomination_minor_unit_value_check"
		)
		await expectRejected(
			activePool,
			"insert into piso_camp_currency_denomination values ('ngc-coins', 'bad-order', 1, 'Bad', -1)",
			"piso_camp_currency_denomination_sort_order_check"
		)
		await expectRejected(
			activePool,
			`insert into content_item (content_type, status, created_by, last_edited_by)
			 values ('video', 'draft', $1, $1)`,
			"content_item_type_check",
			[actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_item (content_type, status, created_by, last_edited_by)
			 values ('advisory', 'deleted', $1, $1)`,
			"content_item_status_check",
			[actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 0, 'draft', 'banknote', 'Title', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $2)`,
			"content_version_number_check",
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body, created_by)
			 values ($1, 2, 'draft', 'video', 'Title', 'Summary', 'Body', $2)`,
			/content_version_(type|fields)_check/,
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, 'deleted', 'banknote', 'Title', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $2)`,
			/content_version_(status|lifecycle_fields)_check/,
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body, primary_url, created_by)
			 values ($1, 2, 'draft', 'link', 'Title', 'Summary', null, 'http://example.test', $2)`,
			"content_version_primary_url_check",
			[linkItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', '', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $2)`,
			"content_version_common_text_check",
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', '<b>Title</b>', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $2)`,
			"content_version_common_text_check",
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  approved_by, series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', 'Title', 'Summary', 'Body',
			         $2, 'ngc-banknotes', 'php-20', $2)`,
			/content_version_(approval_fields|lifecycle_fields)_check/,
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  published_at, series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', 'Title', 'Summary', 'Body',
			         now(), 'ngc-banknotes', 'php-20', $2)`,
			/content_version_(publication_fields|lifecycle_fields)_check/,
			[banknoteItemId, actorId]
		)
	})

	it("rejects empty required bodies while preserving an empty optional link body", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', 'Title', 'Summary', '',
			         'ngc-banknotes', 'php-20', $2)`,
			"content_version_fields_check",
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body, created_by)
			 values ($1, 2, 'draft', 'advisory', 'Title', 'Summary', '', $2)`,
			"content_version_fields_check",
			[advisoryItemId, actorId]
		)
		await expectAccepted(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body, primary_url, created_by)
			 values ($1, 1, 'draft', 'link', 'Title', 'Summary', '', 'https://www.bsp.gov.ph/', $2)`,
			[linkItemId, actorId]
		)
	})

	it("rejects null required bodies while preserving a nullable link body", async context => {
		const activePool = requirePostgres(context)
		const requiredCurrencyCases = [
			[banknoteItemId, "banknote", "ngc-banknotes", "php-20"],
			[coinItemId, "coin", "ngc-coins", "php-20"],
			[securityFeatureItemId, "security_feature", "ngc-banknotes", "php-20"],
		] as const

		for (const [itemId, contentType, seriesCode, denominationCode] of requiredCurrencyCases) {
			await expectRejected(
				activePool,
				`insert into content_version
				 (item_id, version_no, status, content_type, title, summary, body,
				  series_code, denomination_code, created_by)
				 values ($1, 2, 'draft', $2, 'Title', 'Summary', null, $3, $4, $5)`,
				"content_version_fields_check",
				[itemId, contentType, seriesCode, denominationCode, actorId]
			)
		}
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body, created_by)
			 values ($1, 2, 'draft', 'advisory', 'Title', 'Summary', null, $2)`,
			"content_version_fields_check",
			[advisoryItemId, actorId]
		)
		await expectAccepted(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body, primary_url, created_by)
			 values ($1, 1, 'draft', 'link', 'Title', 'Summary', null, 'https://www.bsp.gov.ph/', $2)`,
			[linkItemId, actorId]
		)
	})

	it("enforces status-aware approval and publication metadata", async context => {
		const activePool = requirePostgres(context)
		const baseColumns = `(item_id, version_no, status, content_type, title, summary, body,
			series_code, denomination_code, created_by`
		const baseValues = `($1, 2, $2, 'banknote', 'Title', 'Summary', 'Body',
			'ngc-banknotes', 'php-20', $3`

		await expectRejected(
			activePool,
			`insert into content_version ${baseColumns}, approved_by, approved_at)
			 values ${baseValues}, $3, now())`,
			"content_version_lifecycle_fields_check",
			[banknoteItemId, "draft", actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version ${baseColumns}) values ${baseValues})`,
			"content_version_lifecycle_fields_check",
			[banknoteItemId, "approved", actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version ${baseColumns}, approved_by, approved_at, published_by, published_at)
			 values ${baseValues}, $3, now(), $3, now())`,
			"content_version_lifecycle_fields_check",
			[banknoteItemId, "approved", actorId]
		)

		for (const status of ["published", "unpublished", "deactivated", "archived"]) {
			await expectRejected(
				activePool,
				`insert into content_version ${baseColumns}) values ${baseValues})`,
				"content_version_lifecycle_fields_check",
				[banknoteItemId, status, actorId]
			)
		}

		await expectAccepted(
			activePool,
			`insert into content_version ${baseColumns}) values ${baseValues})`,
			[banknoteItemId, "submitted_for_review", actorId]
		)
		await expectAccepted(
			activePool,
			`insert into content_version ${baseColumns}, approved_by, approved_at)
			 values ${baseValues}, $3, now())`,
			[banknoteItemId, "approved", actorId]
		)
		for (const status of ["published", "unpublished", "deactivated", "archived"]) {
			await expectAccepted(
				activePool,
				`insert into content_version ${baseColumns}, approved_by, approved_at, published_by, published_at)
				 values ${baseValues}, $3, now(), $3, now())`,
				[banknoteItemId, status, actorId]
			)
		}
	})

	it("rejects series/type mismatches, unknown pairs, and cross-item lineage", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', 'Title', 'Summary', 'Body',
			         'ngc-coins', 'php-20', $2)`,
			"content_version_fields_check",
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, 'draft', 'banknote', 'Title', 'Summary', 'Body',
			         'ngc-banknotes', 'php-999', $2)`,
			"content_version_currency_denomination_fkey",
			[banknoteItemId, actorId]
		)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, parent_version_id, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 2, $2, 'draft', 'banknote', 'Title', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $3)`,
			"content_version_parent_item_fkey",
			[banknoteItemId, advisoryVersionId, actorId]
		)
	})

	it("enforces per-item version numbers and immutable content type", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			`insert into content_version
			 (item_id, version_no, status, content_type, title, summary, body,
			  series_code, denomination_code, created_by)
			 values ($1, 1, 'draft', 'banknote', 'Duplicate', 'Summary', 'Body',
			         'ngc-banknotes', 'php-20', $2)`,
			"content_version_item_version_no_unique",
			[banknoteItemId, actorId]
		)
		await activePool.query(
			`insert into content_item (id, content_type, status, created_by, last_edited_by)
			 values ($1, 'advisory', 'draft', $2, $2)`,
			[unversionedItemId, actorId]
		)
		await expectRejected(
			activePool,
			"update content_item set content_type = 'link' where id = $1",
			/immutable content type/i,
			[unversionedItemId]
		)
	})

	it("enforces related-link kind targets, routes, topic FKs, and ordering", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into related_link
			 (id, content_version_id, position, kind, label, external_url)
			 values ('3b9cf3cd-7e51-48f1-8dfa-3764d2ee4111', $1, 0, 'external', 'BSP',
			         'https://www.bsp.gov.ph/')`,
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, external_url)
			 values ($1, 10, 'external', 'Too far', 'https://www.bsp.gov.ph/')`,
			"related_link_position_check",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, external_url)
			 values ($1, 1, 'download', 'Bad kind', 'https://www.bsp.gov.ph/')`,
			"related_link_kind_check",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, external_url)
			 values ($1, 1, 'external', '<b>Bad</b>', 'https://www.bsp.gov.ph/')`,
			"related_link_label_check",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, external_url, internal_route)
			 values ($1, 1, 'external', 'Bad', 'https://www.bsp.gov.ph/', '/pisocamp')`,
			"related_link_target_check",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, external_url)
			 values ($1, 1, 'external', 'HTTP', 'http://example.test')`,
			"related_link_external_url_check",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, internal_route)
			 values ($1, 1, 'internal', 'Bad route', '/Bad Route')`,
			"related_link_internal_route_check",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, target_content_item_id)
			 values ($1, 1, 'topic', 'Missing', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
			"related_link_target_content_item_id_content_item_id_fkey",
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			`insert into related_link
			 (content_version_id, position, kind, label, external_url)
			 values ($1, 0, 'external', 'Duplicate position', 'https://www.bsp.gov.ph/')`,
			"related_link_version_position_unique",
			[banknoteVersionId]
		)
	})

	it("makes content versions and related links append-only", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			"update content_version set title = 'Changed' where id = $1",
			/immutable content_version/i,
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			"delete from content_version where id = $1",
			/immutable content_version/i,
			[banknoteVersionId]
		)
		await expectRejected(
			activePool,
			"update related_link set label = 'Changed' where id = '3b9cf3cd-7e51-48f1-8dfa-3764d2ee4111'",
			/immutable related_link/i
		)
		await expectRejected(
			activePool,
			"delete from related_link where id = '3b9cf3cd-7e51-48f1-8dfa-3764d2ee4111'",
			/immutable related_link/i
		)
	})

	it("restricts deletion of governed users, items, and catalog rows", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			"delete from users where id = $1",
			/content_item_created_by_users_id_fkey|content_version_created_by_users_id_fkey/,
			[actorId]
		)
		await expectRejected(
			activePool,
			"delete from content_item where id = $1",
			/content_version_item_id_content_item_id_fkey/,
			[banknoteItemId]
		)
		await expectRejected(
			activePool,
			"delete from piso_camp_currency_denomination where series_code = 'ngc-banknotes' and code = 'php-20'",
			/content_version_currency_denomination_fkey/
		)
		await expectRejected(
			activePool,
			"delete from piso_camp_currency_series where code = 'ngc-banknotes'",
			/piso_camp_currency_denomination.*fkey/
		)
	})
})
