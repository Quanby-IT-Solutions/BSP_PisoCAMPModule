import "dotenv/config"

import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const migrationNames = {
	catalog: `f2_migration_spec_${process.pid}`,
	promotion: `f2_promotion_spec_${process.pid}`,
} as const
const f2MigrationName = "20260824065559_overrated_echo"
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const adminUrl = sourceUrl ? new URL(sourceUrl) : undefined
if (adminUrl) adminUrl.pathname = "/postgres"

let admin: pg.Client | undefined
let catalogPool: pg.Pool | undefined
let promotionPool: pg.Pool | undefined
let reachable = false
let adminConnected = false
const createdDatabases = new Set<string>()
const unavailableErrorCodes = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"ETIMEDOUT",
	"53300",
	"57P03",
])

function isPostgresUnavailable(error: unknown): boolean {
	if (error instanceof AggregateError) return error.errors.some(isPostgresUnavailable)
	if (typeof error !== "object" || error === null || !("code" in error)) return false
	return unavailableErrorCodes.has(String(error.code))
}

function databaseUrl(name: string): string | undefined {
	if (!sourceUrl) return undefined
	const url = new URL(sourceUrl)
	url.pathname = `/${name}`
	return url.toString()
}

async function applySqlMigration(targetPool: pg.Pool, name: string): Promise<void> {
	const source = await readFile(`${migrationsFolder}/${name}/migration.sql`, "utf8")
	const client = await targetPool.connect()
	try {
		await client.query("begin")
		await client.query(source)
		await client.query("commit")
	} catch (error) {
		await client.query("rollback")
		throw error
	} finally {
		client.release()
	}
}

beforeAll(async () => {
	if (!adminUrl) return
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	try {
		await admin.connect()
	} catch (error) {
		if (!isPostgresUnavailable(error)) throw error
		await admin.end().catch(() => undefined)
		admin = undefined
		return
	}
	adminConnected = true

	for (const databaseName of Object.values(migrationNames)) {
		const existing = await admin.query("select 1 from pg_database where datname = $1", [
			databaseName,
		])
		if (existing.rowCount) throw new Error(`Refusing to reuse ${databaseName}`)
		await admin.query(`create database "${databaseName}"`)
		createdDatabases.add(databaseName)
	}

	catalogPool = new pg.Pool({ connectionString: databaseUrl(migrationNames.catalog) })
	promotionPool = new pg.Pool({ connectionString: databaseUrl(migrationNames.promotion) })
	reachable = true
})

afterAll(async () => {
	await catalogPool?.end()
	await promotionPool?.end()
	if (admin && adminConnected) {
		for (const databaseName of createdDatabases) {
			await admin.query(
				"select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
				[databaseName]
			)
			await admin.query(`drop database if exists "${databaseName}"`)
		}
		await admin.end()
		adminConnected = false
	}
})

describe("migration-only database", () => {
	it("bootstraps the complete explicit permission spine and status constraint", async () => {
		if (!reachable || !catalogPool) {
			process.stderr.write("[f2 migration] skipped: disposable PostgreSQL database unavailable\n")
			return
		}

		const database = drizzle({ client: catalogPool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })

		const roleRows = await catalogPool.query<{ name: string }>(
			"select name from roles order by name"
		)
		expect(roleRows.rows.map(row => row.name)).toEqual(
			[
				"Admin",
				"Content Administrator",
				"Content Approver",
				"Guest User",
				"Manager",
				"Registered End User",
				"Reports & Analytics User",
				"System Administrator",
				"User",
			].sort()
		)

		const adminGrants = await catalogPool.query<{ name: string }>(`
			select p.name
			from role_permissions rp
			join roles r on r.id = rp.role_id
			join permissions p on p.id = rp.permission_id
			where r.name = 'Admin'
			order by p.name
		`)
		expect(adminGrants.rows.map(row => row.name)).toEqual(
			[
				"posts:*",
				"posts:create",
				"posts:delete",
				"posts:edit",
				"posts:read",
				"users:manage",
				"users:read",
				"users:read-directory",
			].sort()
		)

		const piiGrants = await catalogPool.query<{ count: number }>(`
			select count(*)::int as count
			from role_permissions rp
			join permissions p on p.id = rp.permission_id
			where p.name = 'reports.pii.view'
		`)
		expect(piiGrants.rows[0]?.count).toBe(0)

		const constraints = await catalogPool.query<{ constraint_name: string }>(`
			select constraint_name
			from information_schema.table_constraints
			where table_name = 'pisocamp_account_state' and constraint_type = 'CHECK'
		`)
		expect(constraints.rows.map(row => row.constraint_name)).toContain(
			"pisocamp_account_state_status_check"
		)
	})

	it("promotes an existing pre-F2 legacy Admin holder to System Administrator", async () => {
		if (!reachable || !promotionPool) {
			process.stderr.write("[f2 migration] skipped: disposable PostgreSQL database unavailable\n")
			return
		}

		const preF2Migrations = (await readdir(migrationsFolder, { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && entry.name < f2MigrationName)
			.map(entry => entry.name)
			.sort()
		expect(preF2Migrations).toEqual([
			"20260608075354_baseline",
			"20260608075420_rbac",
			"20260701101735_broken_maria_hill",
			"20260812004554_curly_peter_quill",
			"20260812014716_wooden_may_parker",
			"20260812043833_hy2_verifications_expiry_idx",
		])
		for (const migrationName of preF2Migrations) {
			await applySqlMigration(promotionPool, migrationName)
		}

		await promotionPool.query(`
			insert into users (id, name, email, email_verified)
			values ('pre-f2-admin', 'Pre-F2 Admin', 'pre-f2-admin@test.local', true)
		`)
		await promotionPool.query(`
			insert into roles (name, description)
			values ('Admin', 'Legacy administrator')
		`)
		await promotionPool.query(`
			insert into user_roles (user_id, role_id)
			select 'pre-f2-admin', id from roles where name = 'Admin'
		`)

		const before = await promotionPool.query<{ name: string }>(`
			select r.name from user_roles ur
			join roles r on r.id = ur.role_id
			where ur.user_id = 'pre-f2-admin'
			order by r.name
		`)
		expect(before.rows.map(row => row.name)).toEqual(["Admin"])

		await applySqlMigration(promotionPool, f2MigrationName)

		const after = await promotionPool.query<{ name: string }>(`
			select r.name from user_roles ur
			join roles r on r.id = ur.role_id
			where ur.user_id = 'pre-f2-admin'
			order by r.name
		`)
		expect(after.rows.map(row => row.name)).toEqual(["Admin", "System Administrator"])
	})
})
