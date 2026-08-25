import "dotenv/config"

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest"

import { seedPisoCampLocations } from "./pisocamp-location-seed.js"
import { schema } from "./schema.js"

const migrationFile = fileURLToPath(
	new URL("./migrations/20260824234024_f3_profile_foundation/migration.sql", import.meta.url)
)
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const databaseName = `f3_profile_migration_${process.pid}`
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const adminUrl = sourceUrl ? new URL(sourceUrl) : undefined
if (adminUrl) adminUrl.pathname = "/postgres"
let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let unavailableReason = "PostgreSQL availability was not checked"

function requirePostgres(context: TestContext): pg.Pool {
	if (pool) return pool
	context.skip(`PostgreSQL unavailable: ${unavailableReason}`)
	throw new Error("Vitest context.skip returned unexpectedly")
}

beforeAll(async () => {
	if (!adminUrl || !sourceUrl) {
		unavailableReason = "DATABASE_URL is not set"
		if (process.env.CI === "true") {
			throw new Error(`F3 migration tests require PostgreSQL in CI: ${unavailableReason}`)
		}
		return
	}
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	try {
		await admin.connect()
	} catch {
		admin = undefined
		unavailableReason = "connection failed"
		if (process.env.CI === "true") {
			throw new Error(`F3 migration tests require PostgreSQL in CI: ${unavailableReason}`)
		}
		return
	}
	await admin.query(`create database "${databaseName}"`)
	const url = new URL(sourceUrl)
	url.pathname = `/${databaseName}`
	pool = new pg.Pool({ connectionString: url.toString() })
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

describe("single additive F3 profile migration", () => {
	it("embeds the pinned normalized PSA catalog", async () => {
		const sql = await readFile(migrationFile, "utf8")
		expect(sql).toContain("PSGC-2Q-2026")
		expect(sql).toContain("d346ceb5d7ecc4f6ead8471e4b498542c5ce91ae37b179904893ef2ec7f4667c")
	})

	it("migrates a fresh database to exactly 18 regions and 149 cities and reapplies", async context => {
		const activePool = requirePostgres(context)
		const db = drizzle({ client: activePool })
		await migrate(db, { migrationsFolder })
		await migrate(db, { migrationsFolder })
		const counts = await activePool.query(
			"select (select count(*)::int from region) regions, (select count(*)::int from city) cities"
		)
		expect(counts.rows[0]).toEqual({ regions: 18, cities: 149 })
	})

	it("reapplies the supported seed path idempotently", async context => {
		const activePool = requirePostgres(context)
		const db = drizzle({ client: activePool, schema })
		await seedPisoCampLocations(db)
		await seedPisoCampLocations(db)
		const counts = await activePool.query(
			"select (select count(*)::int from region) regions, (select count(*)::int from city) cities"
		)
		expect(counts.rows[0]).toEqual({ regions: 18, cities: 149 })
	})
})
