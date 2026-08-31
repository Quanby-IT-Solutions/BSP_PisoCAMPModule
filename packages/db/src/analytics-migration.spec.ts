import "dotenv/config"

import { cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest"

const migrationName = "20260830120000_an1_analytics_event_pipeline"
const databaseName = `an1_task2_analytics_migration_${process.pid}_test`
const upgradeDatabaseName = `an1_task2_analytics_upgrade_${process.pid}_test`
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const destructiveOptIn = process.env.RUN_AN1_TASK2_DB_MIGRATION_TESTS === "true"
const migrationDatabaseUrl = process.env.AN1_TASK2_DATABASE_URL ?? process.env.DATABASE_URL
const sourceUrl = migrationDatabaseUrl ? new URL(migrationDatabaseUrl) : undefined

let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let upgradePool: pg.Pool | undefined
let preAnalyticsMigrationsFolder: string | undefined
let unavailableReason = "PostgreSQL availability was not checked"

async function assertDisposablePostgres(input: {
	allowDestructive: string | undefined
	databaseUrl: string | undefined
}): Promise<void> {
	const guard = await import(
		new URL("../../../apps/backend/src/test-support/destructive-database.guard.ts", import.meta.url)
			.href
	)
	guard.assertDisposablePostgres(input)
}

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
	context.skip(`Dedicated PostgreSQL unavailable: ${unavailableReason}`)
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

function analyticsInsert(column: string, value: string): string {
	return `insert into analytics_event (
		event_id, schema_version, event_name, occurred_at, subject_pseudo_id, session_id,
		account_type, screen, feature, app_version, os_name, os_version, device_category,
		network_state, status, properties
	) values (
		'11111111-1111-4111-8111-111111111111', 1, 'module_entry', now(), 'abcdefghijklmnopqrstuv',
		'22222222-2222-4222-8222-222222222222', 'guest', 'pisocamp_home', 'module', '1.0.0+1',
		'android', '14', 'phone', 'online', 'completed', '{"entryPoint":"navigation"}'::jsonb
	)`.replace(column, value)
}

const validCatalogEvents = [
	{
		eventId: "44444444-4444-4444-8444-444444444444",
		eventName: "module_entry",
		screen: "pisocamp_home",
		feature: "module",
		status: "completed",
		properties: { entryPoint: "navigation" },
	},
	{
		eventId: "55555555-5555-4555-8555-555555555555",
		eventName: "account_prompt_shown",
		screen: "pisocamp_home",
		feature: "account_prompt",
		status: "completed",
		properties: {},
	},
	{
		eventId: "66666666-6666-4666-8666-666666666666",
		eventName: "account_prompt_guest",
		screen: "pisocamp_home",
		feature: "account_prompt",
		status: "completed",
		properties: {},
	},
	{
		eventId: "77777777-7777-4777-8777-777777777777",
		eventName: "content_view",
		screen: "currency_detail",
		feature: "currency_education",
		status: "completed",
		properties: { logicalId: "currency.ngc.php-20" },
	},
] as const

async function insertCatalogEvent(
	activePool: pg.Pool,
	event: (typeof validCatalogEvents)[number]
): Promise<void> {
	await activePool.query(
		`insert into analytics_event (
			event_id, schema_version, event_name, occurred_at, subject_pseudo_id, session_id,
			account_type, screen, feature, app_version, os_name, os_version, device_category,
			network_state, status, properties
		) values (
			$1, 1, $2, now(), 'abcdefghijklmnopqrstuv', '22222222-2222-4222-8222-222222222222',
			'guest', $3, $4, '1.0.0+1', 'android', '14', 'phone', 'online', $5, $6::jsonb
		)`,
		[
			event.eventId,
			event.eventName,
			event.screen,
			event.feature,
			event.status,
			JSON.stringify(event.properties),
		]
	)
}

beforeAll(async () => {
	if (!destructiveOptIn) {
		unavailableReason = "RUN_AN1_TASK2_DB_MIGRATION_TESTS=true is required"
		if (process.env.CI === "true") throw new Error(unavailableReason)
		return
	}

	await assertDisposablePostgres({
		allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
		databaseUrl: migrationDatabaseUrl,
	})
	if (!sourceUrl) throw new Error("DATABASE_URL is required after destructive-test opt-in")

	admin = new pg.Client({ connectionString: sourceUrl.toString() })
	try {
		await admin.connect()
	} catch (error) {
		if (!isUnavailable(error)) throw error
		await admin.end().catch(() => undefined)
		admin = undefined
		unavailableReason = `connection failed (${String((error as { code?: string }).code ?? "unknown")})`
		if (process.env.CI === "true") throw new Error(unavailableReason)
		return
	}

	const existing = await admin.query("select datname from pg_database where datname = any($1)", [
		[databaseName, upgradeDatabaseName],
	])
	if (existing.rowCount) {
		throw new Error(`Refusing to reuse ${existing.rows.map(row => row.datname).join(", ")}`)
	}
	await admin.query(`create database "${databaseName}"`)
	await admin.query(`create database "${upgradeDatabaseName}"`)

	const databaseUrl = new URL(sourceUrl)
	databaseUrl.pathname = `/${databaseName}`
	pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 1 })
	const upgradeDatabaseUrl = new URL(sourceUrl)
	upgradeDatabaseUrl.pathname = `/${upgradeDatabaseName}`
	upgradePool = new pg.Pool({ connectionString: upgradeDatabaseUrl.toString(), max: 1 })

	preAnalyticsMigrationsFolder = await mkdtemp(join(tmpdir(), "an1-task2-pre-analytics-"))
	const migrationEntries = await readdir(migrationsFolder, { withFileTypes: true })
	for (const entry of migrationEntries) {
		if (!entry.isDirectory() || entry.name >= migrationName) continue
		await cp(join(migrationsFolder, entry.name), join(preAnalyticsMigrationsFolder, entry.name), {
			recursive: true,
		})
	}
})

afterAll(async () => {
	await pool?.end()
	await upgradePool?.end()
	if (admin) {
		for (const targetDatabase of [databaseName, upgradeDatabaseName]) {
			await admin.query(
				"select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
				[targetDatabase]
			)
			await admin.query(`drop database if exists "${targetDatabase}"`)
		}
		await admin.end()
	}
	if (preAnalyticsMigrationsFolder) {
		await rm(preAnalyticsMigrationsFolder, { recursive: true, force: true })
	}
})

describe.sequential("single additive AN-1 analytics-event migration", () => {
	it("migrates a fresh dedicated database and safely reapplies", async context => {
		const activePool = requirePostgres(context)
		const database = drizzle({ client: activePool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })

		const table = await activePool.query<{ table_name: string }>(`
			select table_name from information_schema.tables
			where table_schema = 'public' and table_name = 'analytics_event'
		`)
		expect(table.rows.map(row => row.table_name)).toEqual(["analytics_event"])
	})

	it("enforces analytics idempotency and database-owned envelope constraints", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			analyticsInsert(
				"'11111111-1111-4111-8111-111111111111'",
				"'33333333-3333-4333-8333-333333333333'"
			)
		)
		await expectRejected(
			activePool,
			analyticsInsert(
				"'11111111-1111-4111-8111-111111111111'",
				"'33333333-3333-4333-8333-333333333333'"
			),
			/duplicate key value/i
		)

		for (const [column, invalidValue, expected] of [
			["1, 'module_entry'", "2, 'module_entry'", "analytics_event_schema_version_check"],
			["'module_entry'", "'unregistered_event'", /analytics_event_(name|catalog)_check/],
			["'abcdefghijklmnopqrstuv'", "'too-short'", "analytics_event_subject_pseudo_id_check"],
			["'guest'", "'staff'", "analytics_event_account_type_check"],
			["'pisocamp_home', 'module'", "'currency_detail', 'module'", "analytics_event_catalog_check"],
			["'1.0.0+1'", "repeat(' ', 65)", "analytics_event_app_version_check"],
			["'android'", "'desktop'", "analytics_event_os_name_check"],
			["'14'", "repeat(' ', 97)", "analytics_event_os_version_check"],
			["'phone'", "'watch'", "analytics_event_device_category_check"],
			["'online'", "'metered'", "analytics_event_network_state_check"],
			["'completed'", "'invalid'", /analytics_event_(catalog|status)_check/],
			[
				'\'{"entryPoint":"navigation"}\'::jsonb',
				"'[]'::jsonb",
				"analytics_event_properties_object_check",
			],
		] as const) {
			await expectRejected(activePool, analyticsInsert(column, invalidValue), expected)
		}
	})

	it("accepts every registered catalog combination and rejects catalog mismatches", async context => {
		const activePool = requirePostgres(context)
		for (const event of validCatalogEvents) {
			await insertCatalogEvent(activePool, event)
		}

		const persisted = await activePool.query<{ event_name: string }>(
			"select event_name from analytics_event where event_id = any($1::uuid[]) order by event_name",
			[validCatalogEvents.map(event => event.eventId)]
		)
		expect(persisted.rows.map(row => row.event_name)).toEqual([
			"account_prompt_guest",
			"account_prompt_shown",
			"content_view",
			"module_entry",
		])

		for (const [column, invalidValue] of [
			["'module_entry'", "'unregistered_event'"],
			["'pisocamp_home', 'module'", "'currency_detail', 'module'"],
			["'pisocamp_home', 'module'", "'pisocamp_home', 'currency_education'"],
			["'completed'", "'invalid'"],
		] as const) {
			await expectRejected(
				activePool,
				analyticsInsert(column, invalidValue),
				/analytics_event_(name|catalog|status)_check/
			)
		}
	})

	it("contains no prohibited PII columns and has each reporting index", async context => {
		const activePool = requirePostgres(context)
		const columns = await activePool.query<{ column_name: string }>(`
			select column_name from information_schema.columns
			where table_schema = 'public' and table_name = 'analytics_event'
		`)
		const prohibitedColumns = [
			"account_id",
			"email",
			"name",
			"ip_address",
			"user_agent",
			"image",
			"token",
			"cookie",
			"authorization",
		]
		expect(
			columns.rows.map(row => row.column_name).filter(column => prohibitedColumns.includes(column))
		).toEqual([])

		const indexes = await activePool.query<{ indexname: string }>(`
			select indexname from pg_indexes
			where schemaname = 'public' and tablename = 'analytics_event'
		`)
		expect(indexes.rows.map(row => row.indexname)).toEqual(
			expect.arrayContaining([
				"analytics_event_name_occurred_at_idx",
				"analytics_event_subject_occurred_at_idx",
				"analytics_event_session_occurred_at_idx",
			])
		)
	})

	it("upgrades the complete preceding schema without losing existing rows", async context => {
		if (!upgradePool || !preAnalyticsMigrationsFolder) {
			context.skip(`Dedicated PostgreSQL unavailable: ${unavailableReason}`)
			return
		}
		const database = drizzle({ client: upgradePool })
		await migrate(database, { migrationsFolder: preAnalyticsMigrationsFolder })
		await upgradePool.query(
			"insert into module_configuration (key, value) values ('an1_task2_upgrade_sentinel', '\"retained\"'::jsonb)"
		)
		await migrate(database, { migrationsFolder })

		const sentinel = await upgradePool.query<{ value: string }>(
			"select value #>> '{}' as value from module_configuration where key = 'an1_task2_upgrade_sentinel'"
		)
		expect(sentinel.rows).toEqual([{ value: "retained" }])
		const analyticsTable = await upgradePool.query<{ table_name: string }>(`
			select table_name from information_schema.tables
			where table_schema = 'public' and table_name = 'analytics_event'
		`)
		expect(analyticsTable.rows.map(row => row.table_name)).toEqual(["analytics_event"])
	})
})
