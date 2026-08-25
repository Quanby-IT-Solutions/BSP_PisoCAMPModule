import "dotenv/config"

import { readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { importApprovedPrivacyNotice } from "./privacy-notice-import.js"
import { schema } from "./schema.js"

const f2MigrationName = "20260824065559_overrated_echo"
const f4MigrationName = "20260824121810_f4_consent_foundation"
const databaseName = `f4_consent_migration_spec_${process.pid}`
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const adminUrl = sourceUrl ? new URL(sourceUrl) : undefined
if (adminUrl) adminUrl.pathname = "/postgres"

let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let reachable = false

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

beforeAll(async () => {
	if (!adminUrl || !sourceUrl) return
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	try {
		await admin.connect()
	} catch (error) {
		if (!isUnavailable(error)) throw error
		await admin.end().catch(() => undefined)
		admin = undefined
		return
	}
	const existing = await admin.query("select 1 from pg_database where datname = $1", [databaseName])
	if (existing.rowCount) throw new Error(`Refusing to reuse ${databaseName}`)
	await admin.query(`create database "${databaseName}"`)
	const databaseUrl = new URL(sourceUrl)
	databaseUrl.pathname = `/${databaseName}`
	pool = new pg.Pool({ connectionString: databaseUrl.toString() })
	reachable = true
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

describe("single additive F4 migration", () => {
	it("keeps exactly one named F4 migration after F2", async () => {
		const names = (await readdir(migrationsFolder, { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && entry.name > f2MigrationName)
			.map(entry => entry.name)
		expect(names.filter(name => name === f4MigrationName)).toHaveLength(1)
	})

	it("upgrades and reapplies into a fail-closed migration-only state", async () => {
		if (!reachable || !pool) {
			process.stderr.write("[f4 migration] skipped: disposable PostgreSQL database unavailable\n")
			return
		}

		const database = drizzle({ client: pool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })

		const tables = await pool.query<{ table_name: string }>(`
			select table_name from information_schema.tables
			where table_schema = 'public' and table_name in ('privacy_notice', 'consent_record')
			order by table_name
		`)
		expect(tables.rows.map(row => row.table_name)).toEqual(["consent_record", "privacy_notice"])

		const config = await pool.query<{ value: unknown }>(
			"select value from module_configuration where key = 'active_privacy_notice_version'"
		)
		expect(config.rows[0]?.value).toBe("2024-12-26")
		const notices = await pool.query("select id from privacy_notice")
		expect(notices.rowCount).toBe(0)
	})

	it("enforces subject, catalog, foreign-key, and append-only evidence constraints", async () => {
		if (!reachable || !pool) return
		const database = drizzle({ client: pool, schema })
		const fixtureBody = "TEST FIXTURE ONLY — not approved legal copy."
		const fixtureSha256 = (await import("node:crypto"))
			.createHash("sha256")
			.update(fixtureBody, "utf8")
			.digest("hex")
		await importApprovedPrivacyNotice(database, {
			body: fixtureBody,
			expectedSha256: fixtureSha256,
		})
		await importApprovedPrivacyNotice(database, {
			body: fixtureBody,
			expectedSha256: fixtureSha256,
		})
		const imported = await pool.query("select id from privacy_notice")
		expect(imported.rowCount).toBe(1)

		await expect(
			pool.query(`
				insert into consent_record
				(id, purpose, notice_id, notice_version, status, responded_at)
				values (
					'6aa31d53-d40e-4e55-8135-8a7da0e221e6', 'registration',
					'1cca6b9c-b217-5e59-b679-c9368763274d', '2024-12-26', 'granted', now()
				)
			`)
		).rejects.toMatchObject({ constraint: "consent_record_subject_xor_check" })

		await expect(
			pool.query(`
				insert into consent_record
				(id, device_pseudo_id, purpose, notice_id, notice_version, status, responded_at)
				values (
					'6aa31d53-d40e-4e55-8135-8a7da0e221e6', 'bad-device', 'tracking',
					'1cca6b9c-b217-5e59-b679-c9368763274d', '2024-12-26', 'accepted', now()
				)
			`)
		).rejects.toBeDefined()

		await pool.query(`
			insert into consent_record
			(id, device_pseudo_id, purpose, notice_id, notice_version, status, responded_at)
			values (
				'6aa31d53-d40e-4e55-8135-8a7da0e221e6', 'AbCdEfGhIjKlMnOpQrSt_-', 'registration',
				'1cca6b9c-b217-5e59-b679-c9368763274d', '2024-12-26', 'granted', now()
			)
		`)
		await expect(
			pool.query(
				"update consent_record set status = 'declined' where id = '6aa31d53-d40e-4e55-8135-8a7da0e221e6'"
			)
		).rejects.toThrow(/append-only/i)
		await expect(
			pool.query("delete from privacy_notice where id = '1cca6b9c-b217-5e59-b679-c9368763274d'")
		).rejects.toThrow(/append-only/i)
	})
})
