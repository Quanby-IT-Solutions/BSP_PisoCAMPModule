import "dotenv/config"

import { access, cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest"

const previousMigrationName = "20260826105155_cm3_content_workflow_foundation"
const ce1MigrationName = "20260827093021_ce1_bundle_state_and_leases"
const an1MigrationName = "20260830120000_an1_analytics_event_pipeline"
const requiredAdminDatabase = "ce1_task2_bundle_admin"
const databaseName = `ce1_task2_bundle_${process.pid}`
const upgradeDatabaseName = `ce1_task2_upgrade_${process.pid}`
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const destructiveOptIn = process.env.RUN_CE1_TASK2_DB_MIGRATION_TESTS === "true"
const migrationDatabaseUrl = process.env.CE1_TASK2_DATABASE_URL ?? process.env.DATABASE_URL
const sourceUrl = migrationDatabaseUrl ? new URL(migrationDatabaseUrl) : undefined

const actorId = "ce1-task2-db-user"
const itemId = "8fbf8bd8-b52e-4689-8bad-dd3b0d7d1111"
const otherItemId = "e25dcc5c-b1eb-41df-b32b-14139e6a2222"
const publishedVersionId = "e6053d3e-20ec-4870-b5e9-e675d5414444"
const secondPublishedVersionId = "84a40169-bb61-4bf9-8afd-e89b10a95555"
const thirdPublishedVersionId = "29b46c28-00b8-4b45-9f50-9a6868a66666"
const fourthPublishedVersionId = "b9b14f3a-2a60-4a8b-b465-4cd191ab7777"
const digest = "a".repeat(64)
const secondDigest = "b".repeat(64)
const signature = "A".repeat(86)

let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let upgradePool: pg.Pool | undefined
let preCe1MigrationsFolder: string | undefined
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

async function insertBundle(activePool: pg.Pool): Promise<{ id: string; version: string }> {
	const result = await activePool.query<{ id: string; version: string }>(
		"insert into content_bundle (state) values ('building') returning id, version::text"
	)
	const row = result.rows[0]
	if (!row) throw new Error("bundle insert returned no row")
	return row
}

async function markReady(activePool: pg.Pool, id: string): Promise<void> {
	await activePool.query(
		`update content_bundle
		 set state = 'ready', manifest_payload = 'e30', manifest_sha256 = $2,
		     algorithm = 'Ed25519', key_id = 'ce1-test-v1', signature = $3, ready_at = now()
		 where id = $1`,
		[id, digest, signature]
	)
}

async function waitForBackendLock(activePool: pg.Pool, backendPid: number): Promise<boolean> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const result = await activePool.query<{ waiting: boolean }>(
			`select coalesce(wait_event_type = 'Lock', false) waiting
			 from pg_stat_activity where pid = $1`,
			[backendPid]
		)
		if (result.rows[0]?.waiting) return true
		await new Promise(resolve => setTimeout(resolve, 25))
	}
	return false
}

async function waitForLeaseExpiry(activePool: pg.Pool, requestId: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const result = await activePool.query<{ expired: boolean }>(
			`select lease_expires_at <= clock_timestamp() expired
			 from content_bundle_rebuild_request where id = $1`,
			[requestId]
		)
		if (result.rows[0]?.expired) return
		await new Promise(resolve => setTimeout(resolve, 25))
	}
	throw new Error(`lease did not expire for ${requestId}`)
}

beforeAll(async () => {
	if (!destructiveOptIn) {
		unavailableReason = "RUN_CE1_TASK2_DB_MIGRATION_TESTS=true is required"
		if (process.env.CI === "true") throw new Error(unavailableReason)
		return
	}
	if (!sourceUrl) throw new Error("DATABASE_URL is required after destructive-test opt-in")
	if (!new Set(["127.0.0.1", "localhost", "::1"]).has(sourceUrl.hostname)) {
		throw new Error("CE-1 Task 2 migration tests require a loopback DATABASE_URL")
	}
	if (sourceUrl.pathname !== `/${requiredAdminDatabase}`) {
		throw new Error(
			`CE-1 Task 2 migration tests require the dedicated ${requiredAdminDatabase} database`
		)
	}

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
	pool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 4 })
	const upgradeDatabaseUrl = new URL(sourceUrl)
	upgradeDatabaseUrl.pathname = `/${upgradeDatabaseName}`
	upgradePool = new pg.Pool({ connectionString: upgradeDatabaseUrl.toString(), max: 1 })
	preCe1MigrationsFolder = await mkdtemp(join(tmpdir(), "ce1-task2-pre-ce1-"))
	const migrationEntries = await readdir(migrationsFolder, { withFileTypes: true })
	for (const entry of migrationEntries) {
		if (!entry.isDirectory() || entry.name > previousMigrationName) continue
		await cp(join(migrationsFolder, entry.name), join(preCe1MigrationsFolder, entry.name), {
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
	if (preCe1MigrationsFolder) {
		await rm(preCe1MigrationsFolder, { recursive: true, force: true })
	}
})

describe.sequential("single additive CE-1 bundle-state migration", () => {
	it("identifies the CE-1 migration before the later AN-1 migration", async () => {
		const directories = (await readdir(migrationsFolder, { withFileTypes: true })).filter(
			entry => entry.isDirectory() && entry.name > previousMigrationName
		)
		const names: string[] = []
		for (const directory of directories) {
			try {
				await access(`${migrationsFolder}/${directory.name}/migration.sql`)
				names.push(directory.name)
			} catch {
				// Drizzle may leave an empty parity-probe directory; it is not a migration.
			}
		}
		expect(names).toContain(ce1MigrationName)
		expect(names).toContain(an1MigrationName)
		expect(names.indexOf(an1MigrationName)).toBeGreaterThan(names.indexOf(ce1MigrationName))
	})

	it("migrates a fresh dedicated database and safely reapplies the runner", async context => {
		const activePool = requirePostgres(context)
		const database = drizzle({ client: activePool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })
		await activePool.query(
			`insert into users (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'CE-1 Task 2 User', 'ce1-task2-db@example.test', true, now(), now())`,
			[actorId]
		)
		await activePool.query(
			`insert into content_item
			 (id, content_type, status, created_by, last_edited_by)
			 values ($1, 'advisory', 'published', $3, $3),
			        ($2, 'advisory', 'published', $3, $3)`,
			[itemId, otherItemId, actorId]
		)
		await activePool.query(
			`insert into content_version
			 (id, item_id, version_no, status, content_type, title, summary, body, created_by,
			  approved_by, approved_at, published_by, published_at, transition_action)
			 values ($1, $5, 1, 'published', 'advisory', 'Published', 'Summary', 'Body', $6,
			         $6, now(), $6, now(), 'publish'),
			        ($2, $5, 2, 'published', 'advisory', 'Published again', 'Summary', 'Body', $6,
			         $6, now(), $6, now(), 'publish'),
			        ($3, $5, 3, 'published', 'advisory', 'Third publication', 'Summary', 'Body', $6,
			         $6, now(), $6, now(), 'publish'),
			        ($4, $5, 4, 'published', 'advisory', 'Fourth publication', 'Summary', 'Body', $6,
			         $6, now(), $6, now(), 'publish')`,
			[
				publishedVersionId,
				secondPublishedVersionId,
				thirdPublishedVersionId,
				fourthPublishedVersionId,
				itemId,
				actorId,
			]
		)
	})

	it("upgrades every legal pre-CE-1 request state into a due ownership-preserving pending row", async context => {
		if (!upgradePool || !preCe1MigrationsFolder) {
			context.skip(`Dedicated PostgreSQL unavailable: ${unavailableReason}`)
			return
		}
		const database = drizzle({ client: upgradePool })
		await migrate(database, { migrationsFolder: preCe1MigrationsFolder })

		const legacyActorId = "ce1-task2-upgrade-user"
		const legacyItemId = "b81928d4-cbbe-4c31-bec6-33adf3d90000"
		const legacyVersionIds = [
			"b81928d4-cbbe-4c31-bec6-33adf3d90001",
			"b81928d4-cbbe-4c31-bec6-33adf3d90002",
			"b81928d4-cbbe-4c31-bec6-33adf3d90003",
			"b81928d4-cbbe-4c31-bec6-33adf3d90004",
			"b81928d4-cbbe-4c31-bec6-33adf3d90005",
		] as const
		const legacyRequestIds = [
			"ce110000-0000-4000-8000-000000000001",
			"ce110000-0000-4000-8000-000000000002",
			"ce110000-0000-4000-8000-000000000003",
			"ce110000-0000-4000-8000-000000000004",
			"ce110000-0000-4000-8000-000000000005",
		] as const

		await upgradePool.query(
			`insert into users (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'CE-1 Upgrade User', 'ce1-upgrade@example.test', true, now(), now())`,
			[legacyActorId]
		)
		await upgradePool.query(
			`insert into content_item
			 (id, content_type, status, created_by, last_edited_by)
			 values ($1, 'advisory', 'published', $2, $2)`,
			[legacyItemId, legacyActorId]
		)
		for (let index = 0; index < legacyVersionIds.length; index += 1) {
			await upgradePool.query(
				`insert into content_version
				 (id, item_id, version_no, status, content_type, title, summary, body, created_by,
				  approved_by, approved_at, published_by, published_at, transition_action)
				 values ($1, $2, $3, 'published', 'advisory', $4, 'Summary', 'Body', $5,
				         $5, now(), $5, now(), 'publish')`,
				[
					legacyVersionIds[index],
					legacyItemId,
					index + 1,
					`Legacy publication ${index + 1}`,
					legacyActorId,
				]
			)
		}
		await upgradePool.query(
			`insert into content_bundle_rebuild_request
			 (id, item_id, published_version_id, state, attempt_count, available_at,
			  last_attempt_at, processed_at, last_error)
			 values
			 ($1, $6, $7, 'pending', 0, now() + interval '10 minutes', null, null, null),
			 ($2, $6, $8, 'pending', 1, now() + interval '10 minutes', now(), null,
			  'Legacy retry detail'),
			 ($3, $6, $9, 'processing', 2, now(), now(), null, null),
			 ($4, $6, $10, 'failed', 3, now() + interval '10 minutes', now(), null,
			  'Legacy builder unavailable'),
			 ($5, $6, $11, 'completed', 4, now(), now(), now(), null)`,
			[...legacyRequestIds, legacyItemId, ...legacyVersionIds]
		)

		await migrate(database, { migrationsFolder })
		const upgraded = await upgradePool.query(
			`select id::text, item_id::text, published_version_id::text, state, attempt_count,
			        last_attempt_at is not null retained_last_attempt,
			        available_at <= clock_timestamp() due,
			        lease_owner, lease_expires_at, processed_bundle_id, processed_at, last_error
			 from content_bundle_rebuild_request order by id`
		)
		expect(upgraded.rows).toEqual(
			legacyRequestIds.map((id, index) => ({
				id,
				item_id: legacyItemId,
				published_version_id: legacyVersionIds[index],
				state: "pending",
				attempt_count: index,
				retained_last_attempt: index > 0,
				due: true,
				lease_owner: null,
				lease_expires_at: null,
				processed_bundle_id: null,
				processed_at: null,
				last_error: null,
			}))
		)
	})

	it("allocates positive unique bundle versions monotonically without caller override", async context => {
		const activePool = requirePostgres(context)
		const first = await insertBundle(activePool)
		await activePool.query(
			"update content_bundle set state = 'failed', failure_code = 'build_failed', failed_at = now() where id = $1",
			[first.id]
		)
		const second = await insertBundle(activePool)
		expect(BigInt(first.version)).toBeGreaterThan(0n)
		expect(BigInt(second.version)).toBeGreaterThan(BigInt(first.version))
		const discarded = await insertBundle(activePool)
		await activePool.query("delete from content_bundle where id = $1", [discarded.id])
		const afterDiscard = await insertBundle(activePool)
		expect(BigInt(afterDiscard.version)).toBeGreaterThan(BigInt(discarded.version))
		await expectRejected(
			activePool,
			"insert into content_bundle (version, state) values (1, 'building')",
			/cannot insert a non-DEFAULT value into column "version"/i
		)
	})

	it("enforces bundle size, envelope, lifecycle, and terminal immutability", async context => {
		const activePool = requirePostgres(context)
		await expectRejected(
			activePool,
			"insert into content_bundle (state, entry_count) values ('building', 2001)",
			"content_bundle_size_check"
		)
		await expectRejected(
			activePool,
			"insert into content_bundle (state, core_byte_length) values ('building', 52428801)",
			"content_bundle_size_check"
		)
		await expectRejected(
			activePool,
			"insert into content_bundle (state, schema_version) values ('building', 2)",
			"content_bundle_schema_version_check"
		)
		const bundle = await insertBundle(activePool)
		await expectRejected(
			activePool,
			"update content_bundle set state = 'ready', ready_at = now() where id = $1",
			"content_bundle_lifecycle_check",
			[bundle.id]
		)
		await markReady(activePool, bundle.id)
		await expectRejected(
			activePool,
			"update content_bundle set manifest_payload = 'changed' where id = $1",
			/terminal content_bundle is immutable/i,
			[bundle.id]
		)
		await expectRejected(
			activePool,
			"delete from content_bundle where id = $1",
			/terminal content_bundle is immutable/i,
			[bundle.id]
		)
	})

	it("rejects every omitted or partial signed-envelope field in every bundle state", async context => {
		const activePool = requirePostgres(context)
		const envelopeColumns = [
			"manifest_payload",
			"manifest_sha256",
			"algorithm",
			"key_id",
			"signature",
		] as const
		const envelopeAssignments = new Map<(typeof envelopeColumns)[number], string>([
			["manifest_payload", "'e30'"],
			["manifest_sha256", `'${digest}'`],
			["algorithm", "'Ed25519'"],
			["key_id", "'ce1-test-v1'"],
			["signature", `'${signature}'`],
		])
		for (const omittedColumn of envelopeColumns) {
			const bundle = await insertBundle(activePool)
			const assignments = envelopeColumns
				.filter(column => column !== omittedColumn)
				.map(column => `${column} = ${envelopeAssignments.get(column)}`)
				.join(", ")
			await expectRejected(
				activePool,
				`update content_bundle
				 set state = 'ready', ${assignments}, ready_at = now()
				 where id = $1`,
				"content_bundle_envelope_check",
				[bundle.id]
			)
		}

		for (const partialColumn of envelopeColumns) {
			const columnValue =
				partialColumn === "manifest_payload"
					? "e30"
					: partialColumn === "manifest_sha256"
						? digest
						: partialColumn === "algorithm"
							? "Ed25519"
							: partialColumn === "key_id"
								? "ce1-test-v1"
								: signature
			for (const terminalState of ["building", "failed"] as const) {
				const bundle = await insertBundle(activePool)
				const failureMetadata =
					terminalState === "failed"
						? ", state = 'failed', failure_code = 'build_failed', failed_at = now()"
						: ""
				await expectRejected(
					activePool,
					`update content_bundle set ${partialColumn} = $2${failureMetadata} where id = $1`,
					"content_bundle_envelope_check",
					[bundle.id, columnValue]
				)
			}
		}
	})

	it("stores bounded bytea blobs with exact length and MIME metadata", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into content_bundle_blob (sha256, byte_length, media_type, body)
			 values ($1, 2, 'application/json', $2::bytea)`,
			[digest, Buffer.from("{}")]
		)
		for (const [sha256, byteLength, mediaType, body, expected] of [
			[
				"A".repeat(64),
				2,
				"application/json",
				Buffer.from("{}"),
				"content_bundle_blob_sha256_check",
			],
			[secondDigest, 0, "application/json", Buffer.alloc(0), "content_bundle_blob_size_check"],
			[secondDigest, 2, "text/html", Buffer.from("{}"), "content_bundle_blob_media_type_check"],
			[
				secondDigest,
				3,
				"application/json",
				Buffer.from("{}"),
				"content_bundle_blob_body_length_check",
			],
		] as const) {
			await expectRejected(
				activePool,
				`insert into content_bundle_blob (sha256, byte_length, media_type, body)
				 values ($1, $2, $3, $4::bytea)`,
				expected,
				[sha256, byteLength, mediaType, body]
			)
		}
		await expectRejected(
			activePool,
			"update content_bundle_blob set body = decode('00', 'hex') where sha256 = $1",
			/immutable content_bundle_blob/i,
			[digest]
		)
	})

	it("enforces deterministic entry identity, resource metadata, and published ownership", async context => {
		const activePool = requirePostgres(context)
		const bundle = await insertBundle(activePool)
		await activePool.query(
			`insert into content_bundle_manifest_entry
			 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256,
			  download_path, content_item_id, content_version_id)
			 values ($1, 'content.advisory.one', 0, 'content', 'core', 'application/json', 2, $2,
			         $3, $4, $5)`,
			[bundle.id, digest, `/pisocamp/bundle/resources/${digest}`, itemId, publishedVersionId]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_manifest_entry
			 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256,
			  download_path, content_item_id, content_version_id)
			 values ($1, 'content.bad-owner', 1, 'content', 'core', 'application/json', 2, $2,
			         $3, $4, $5)`,
			"content_bundle_manifest_entry_content_item_version_fkey",
			[bundle.id, digest, `/pisocamp/bundle/resources/${digest}`, otherItemId, publishedVersionId]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_manifest_entry
			 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256,
			  download_path, content_item_id)
			 values ($1, 'content.unpaired', 1, 'content', 'core', 'application/json', 2, $2, $3, $4)`,
			"content_bundle_manifest_entry_content_pair_check",
			[bundle.id, digest, `/pisocamp/bundle/resources/${digest}`, itemId]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_manifest_entry
			 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256, download_path)
			 values ($1, 'content.bad-path', 1, 'content', 'core', 'application/json', 2, $2, '/unsafe')`,
			"content_bundle_manifest_entry_download_path_check",
			[bundle.id, digest]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_manifest_entry
			 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256, download_path)
			 values ($1, 'content.bad-size', 1, 'content', 'core', 'application/json', 1, $2, $3)`,
			"content_bundle_manifest_entry_blob_metadata_fkey",
			[bundle.id, digest, `/pisocamp/bundle/resources/${digest}`]
		)
		await expectRejected(
			activePool,
			"update content_bundle_manifest_entry set logical_id = 'content.changed' where bundle_id = $1",
			/immutable content_bundle_manifest_entry/i,
			[bundle.id]
		)
		await expectRejected(
			activePool,
			"delete from content_bundle_manifest_entry where bundle_id = $1",
			/immutable content_bundle_manifest_entry/i,
			[bundle.id]
		)
	})

	it("keeps entries append-only to building bundles", async context => {
		const activePool = requirePostgres(context)
		const ready = await insertBundle(activePool)
		await markReady(activePool, ready.id)
		await expectRejected(
			activePool,
			`insert into content_bundle_manifest_entry
			 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256, download_path)
			 values ($1, 'content.too-late', 0, 'content', 'core', 'application/json', 2, $2, $3)`,
			/can be inserted only while its bundle is building/i,
			[ready.id, digest, `/pisocamp/bundle/resources/${digest}`]
		)
	})

	it("serializes an in-flight entry insert before promotion through the parent bundle row", async context => {
		const activePool = requirePostgres(context)
		const bundle = await insertBundle(activePool)
		const entryClient = await activePool.connect()
		const promotionClient = await activePool.connect()
		let promotion: Promise<pg.QueryResult> | undefined
		try {
			await entryClient.query("begin")
			await promotionClient.query("begin")
			await entryClient.query(
				`insert into content_bundle_manifest_entry
				 (bundle_id, logical_id, position, kind, delivery, media_type, byte_length, sha256,
				  download_path)
				 values ($1, 'content.concurrent-entry', 0, 'content', 'core', 'application/json', 2,
				         $2, $3)`,
				[bundle.id, digest, `/pisocamp/bundle/resources/${digest}`]
			)
			const backend = await promotionClient.query<{ pid: number }>("select pg_backend_pid() pid")
			const backendPid = backend.rows[0]?.pid
			if (!backendPid) throw new Error("promotion backend PID was not returned")
			promotion = promotionClient.query(
				`update content_bundle
				 set state = 'ready', manifest_payload = 'e30', manifest_sha256 = $2,
				     algorithm = 'Ed25519', key_id = 'ce1-test-v1', signature = $3,
				     entry_count = 1, core_byte_length = 2, ready_at = now()
				 where id = $1`,
				[bundle.id, digest, signature]
			)
			expect(await waitForBackendLock(activePool, backendPid)).toBe(true)
			await entryClient.query("commit")
			await promotion
			await promotionClient.query("commit")
			promotion = undefined
		} finally {
			await entryClient.query("rollback").catch(() => undefined)
			await promotion?.catch(() => undefined)
			await promotionClient.query("rollback").catch(() => undefined)
			entryClient.release()
			promotionClient.release()
		}

		const result = await activePool.query(
			`select b.state, b.entry_count, count(e.logical_id)::integer entries
			 from content_bundle b
			 left join content_bundle_manifest_entry e on e.bundle_id = b.id
			 where b.id = $1 group by b.id`,
			[bundle.id]
		)
		expect(result.rows).toEqual([{ state: "ready", entry_count: 1, entries: 1 }])
	})

	it("permits only the singleton primary channel and ready higher-version pointer advances", async context => {
		const activePool = requirePostgres(context)
		await activePool.query("insert into content_bundle_channel (id) values ('primary')")
		await expectRejected(
			activePool,
			"insert into content_bundle_channel (id) values ('primary')",
			"content_bundle_channel_pkey"
		)
		await expectRejected(
			activePool,
			"insert into content_bundle_channel (id) values ('secondary')",
			"content_bundle_channel_primary_check"
		)
		const building = await insertBundle(activePool)
		await expectRejected(
			activePool,
			"update content_bundle_channel set current_bundle_id = $1, updated_at = now() where id = 'primary'",
			/current bundle must be ready/i,
			[building.id]
		)
		const first = await insertBundle(activePool)
		await markReady(activePool, first.id)
		await activePool.query(
			"update content_bundle_channel set current_bundle_id = $1, updated_at = now() where id = 'primary'",
			[first.id]
		)
		const second = await insertBundle(activePool)
		await markReady(activePool, second.id)
		await activePool.query(
			"update content_bundle_channel set current_bundle_id = $1, updated_at = now() where id = 'primary'",
			[second.id]
		)
		for (const bundleId of [first.id, second.id]) {
			await expectRejected(
				activePool,
				"update content_bundle_channel set current_bundle_id = $1, updated_at = now() where id = 'primary'",
				/current bundle version must increase/i,
				[bundleId]
			)
		}
		await expectRejected(
			activePool,
			"update content_bundle_channel set id = 'other' where id = 'primary'",
			/immutable content_bundle_channel identity/i
		)
	})

	it("allows rebuild requests to be inserted only in pending state", async context => {
		const activePool = requirePostgres(context)
		const current = await activePool.query<{ current_bundle_id: string }>(
			"select current_bundle_id::text from content_bundle_channel where id = 'primary'"
		)
		const readyBundleId = current.rows[0]?.current_bundle_id
		if (!readyBundleId) throw new Error("ready bundle fixture was not found")
		for (const state of ["processing", "failed", "completed"] as const) {
			await expectRejected(
				activePool,
				`insert into content_bundle_rebuild_request
				 (item_id, published_version_id, state, attempt_count, available_at, last_attempt_at,
				  lease_owner, lease_expires_at, processed_bundle_id, processed_at, last_error)
				 values ($1, $2, $3, 1, now(), now(),
				  case when $3 = 'processing' then 'direct-worker' end,
				  case when $3 = 'processing' then now() + interval '5 minutes' end,
				  case when $3 = 'completed' then $4::uuid end,
				  case when $3 = 'completed' then now() end,
				  case when $3 = 'failed' then 'build_failed' end)`,
				/rebuild request must start pending/i,
				[itemId, publishedVersionId, state, readyBundleId]
			)
		}
	})

	it("requires complete future-at-claim leases and rejects unexpired recovery", async context => {
		const activePool = requirePostgres(context)
		const requestId = "68c9dd1d-284e-4974-af97-40d8d3ed1111"
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[requestId, itemId, publishedVersionId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now()
			 where id = $1`,
			/lease expiry must be future at claim/i,
			[requestId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = 'worker-1', lease_expires_at = now() - interval '1 second'
			 where id = $1`,
			/lease expiry must be future at claim/i,
			[requestId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = '<worker>', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			"content_bundle_rebuild_request_lease_owner_check",
			[requestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = 'worker-1', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			[requestId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'pending', lease_owner = null, lease_expires_at = null,
			     available_at = now(), last_error = 'lease_expired'
			 where id = $1`,
			/cannot recover an unexpired rebuild lease/i,
			[requestId]
		)
	})

	it("recovers an expired claim without changing publication ownership", async context => {
		const activePool = requirePostgres(context)
		const requestId = "e152aed6-6de1-46e4-9e47-53beaf142222"
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[requestId, itemId, secondPublishedVersionId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = 'worker-recovery', lease_expires_at = now() + interval '100 milliseconds'
			 where id = $1`,
			[requestId]
		)
		await activePool.query("select pg_sleep(0.15)")
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'pending', lease_owner = null, lease_expires_at = null,
			     available_at = now(), last_error = 'lease_expired'
			 where id = $1`,
			[requestId]
		)
		const recovered = await activePool.query(
			`select state, attempt_count, lease_owner, lease_expires_at, item_id::text,
			        published_version_id::text, last_error
			 from content_bundle_rebuild_request where id = $1`,
			[requestId]
		)
		expect(recovered.rows).toEqual([
			{
				state: "pending",
				attempt_count: 1,
				lease_owner: null,
				lease_expires_at: null,
				item_id: itemId,
				published_version_id: secondPublishedVersionId,
				last_error: "lease_expired",
			},
		])
	})

	it("reserves expired processing rows for recovery instead of stale worker actions", async context => {
		const activePool = requirePostgres(context)
		const requestId = "61595479-66a4-47c6-8192-d77c583b3333"
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[requestId, itemId, thirdPublishedVersionId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = 'stale-worker', lease_expires_at = now() + interval '100 milliseconds'
			 where id = $1`,
			[requestId]
		)
		await waitForLeaseExpiry(activePool, requestId)
		const current = await activePool.query<{ current_bundle_id: string }>(
			"select current_bundle_id::text from content_bundle_channel where id = 'primary'"
		)
		const readyBundleId = current.rows[0]?.current_bundle_id
		if (!readyBundleId) throw new Error("ready bundle fixture was not found")

		for (const query of [
			`update content_bundle_rebuild_request
			 set lease_expires_at = now() + interval '5 minutes' where id = $1`,
			`update content_bundle_rebuild_request
			 set state = 'failed', lease_owner = null, lease_expires_at = null,
			     available_at = now(), last_error = 'build_failed' where id = $1`,
			`update content_bundle_rebuild_request
			 set state = 'completed', lease_owner = null, lease_expires_at = null,
			     processed_bundle_id = '${readyBundleId}', processed_at = now() where id = $1`,
		]) {
			await expectRejected(activePool, query, /expired rebuild lease belongs to recovery/i, [
				requestId,
			])
		}

		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'pending', lease_owner = null, lease_expires_at = null,
			     available_at = now(), last_error = 'lease_expired'
			 where id = $1`,
			[requestId]
		)
	})

	it("lets a concurrent reclaimer win an expired lease race against a stale worker", async context => {
		const activePool = requirePostgres(context)
		const requestId = "f2b9f4d4-852d-4b36-a95e-cf4be54a8888"
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[requestId, itemId, fourthPublishedVersionId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = 'racing-worker', lease_expires_at = now() + interval '100 milliseconds'
			 where id = $1`,
			[requestId]
		)
		await waitForLeaseExpiry(activePool, requestId)

		const reclaimer = await activePool.connect()
		const staleWorker = await activePool.connect()
		let staleCompletion: Promise<pg.QueryResult> | undefined
		try {
			await reclaimer.query("begin")
			await staleWorker.query("begin")
			await reclaimer.query(
				`update content_bundle_rebuild_request
				 set state = 'pending', lease_owner = null, lease_expires_at = null,
				     available_at = now(), last_error = 'lease_expired'
				 where id = $1`,
				[requestId]
			)
			const backend = await staleWorker.query<{ pid: number }>("select pg_backend_pid() pid")
			const backendPid = backend.rows[0]?.pid
			if (!backendPid) throw new Error("stale-worker backend PID was not returned")
			staleCompletion = staleWorker.query(
				`update content_bundle_rebuild_request
				 set state = 'failed', lease_owner = null, lease_expires_at = null,
				     available_at = now(), last_error = 'build_failed'
				 where id = $1`,
				[requestId]
			)
			expect(await waitForBackendLock(activePool, backendPid)).toBe(true)
			await reclaimer.query("commit")
			await expect(staleCompletion).rejects.toThrow(/illegal rebuild delivery state transition/i)
			staleCompletion = undefined
			await staleWorker.query("rollback")
		} finally {
			await reclaimer.query("rollback").catch(() => undefined)
			await staleCompletion?.catch(() => undefined)
			await staleWorker.query("rollback").catch(() => undefined)
			reclaimer.release()
			staleWorker.release()
		}

		const recovered = await activePool.query(
			"select state, lease_owner, lease_expires_at, last_error from content_bundle_rebuild_request where id = $1",
			[requestId]
		)
		expect(recovered.rows).toEqual([
			{ state: "pending", lease_owner: null, lease_expires_at: null, last_error: "lease_expired" },
		])
	})

	it("supports failed retry claims and associates completion with a ready bundle", async context => {
		const activePool = requirePostgres(context)
		const requestId = "e152aed6-6de1-46e4-9e47-53beaf142222"
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 2, last_attempt_at = now(), last_error = null,
			     lease_owner = 'worker-2', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			[requestId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'failed', lease_owner = null, lease_expires_at = null,
			     available_at = now(), last_error = '<secret>'
			 where id = $1`,
			"content_bundle_rebuild_request_last_error_check",
			[requestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'failed', lease_owner = null, lease_expires_at = null,
			     available_at = now(), last_error = 'build_failed'
			 where id = $1`,
			[requestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 3, last_attempt_at = now(), last_error = null,
			     lease_owner = 'worker-3', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			[requestId]
		)
		const building = await insertBundle(activePool)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'completed', lease_owner = null, lease_expires_at = null,
			     processed_bundle_id = $2, processed_at = now()
			 where id = $1`,
			/processed bundle must be ready/i,
			[requestId, building.id]
		)
		const current = await activePool.query<{ current_bundle_id: string }>(
			"select current_bundle_id::text from content_bundle_channel where id = 'primary'"
		)
		const currentBundleId = current.rows[0]?.current_bundle_id
		expect(currentBundleId).toBeDefined()
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'completed', lease_owner = null, lease_expires_at = null,
			     processed_bundle_id = $2, processed_at = now()
			 where id = $1`,
			[requestId, currentBundleId]
		)
		await expectRejected(
			activePool,
			"update content_bundle_rebuild_request set processed_bundle_id = null where id = $1",
			/terminal completed rebuild request is immutable/i,
			[requestId]
		)
		await expectRejected(
			activePool,
			"delete from content_bundle where id = $1",
			/terminal content_bundle is immutable/i,
			[currentBundleId]
		)
	})

	it("installs due, recovery, ready, entry, and ownership indexes plus invariant triggers", async context => {
		const activePool = requirePostgres(context)
		const indexes = await activePool.query<{ indexname: string }>(
			`select indexname from pg_indexes
			 where schemaname = 'public' and indexname in (
			   'content_bundle_ready_version_idx',
			   'content_bundle_manifest_entry_bundle_idx',
			   'content_bundle_manifest_entry_content_trace_idx',
			   'content_bundle_rebuild_request_poll_idx',
			   'content_bundle_rebuild_request_lease_expiry_idx'
			 ) order by indexname`
		)
		expect(indexes.rows.map(row => row.indexname)).toEqual([
			"content_bundle_manifest_entry_bundle_idx",
			"content_bundle_manifest_entry_content_trace_idx",
			"content_bundle_ready_version_idx",
			"content_bundle_rebuild_request_lease_expiry_idx",
			"content_bundle_rebuild_request_poll_idx",
		])
		const triggers = await activePool.query<{ tgname: string }>(
			`select tgname from pg_trigger
			 where not tgisinternal and tgname in (
			   'content_bundle_immutable_trigger',
			   'content_bundle_blob_immutable_trigger',
			   'content_bundle_manifest_entry_immutable_trigger',
			   'content_bundle_channel_validate_trigger',
			   'content_bundle_rebuild_request_immutable_trigger'
			 ) order by tgname`
		)
		expect(triggers.rows.map(row => row.tgname)).toEqual([
			"content_bundle_blob_immutable_trigger",
			"content_bundle_channel_validate_trigger",
			"content_bundle_immutable_trigger",
			"content_bundle_manifest_entry_immutable_trigger",
			"content_bundle_rebuild_request_immutable_trigger",
		])
	})
})
