import "dotenv/config"

import { access, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const previousMigrationName = "20260830120000_an1_analytics_event_pipeline"
const migrationName = "20260831235247_cm2_content_assets"
const databaseName = `cm2_task2_content_assets_${process.pid}_test`
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const destructiveOptIn = process.env.RUN_CM2_TASK2_DB_MIGRATION_TESTS === "true"
const migrationDatabaseUrl = process.env.CM2_TASK2_DATABASE_URL ?? process.env.DATABASE_URL
const sourceUrl = migrationDatabaseUrl ? new URL(migrationDatabaseUrl) : undefined

const actorId = "cm2-task2-asset-user"
const otherActorId = "cm2-task2-other-user"
const itemId = "8fbf8bd8-b52e-4689-8bad-dd3b0d7d1111"
const otherItemId = "e25dcc5c-b1eb-41df-b32b-14139e6a2222"
const draftVersionId = "5d7386c9-2190-4321-b52c-c350828e1111"
const publishedVersionId = "e6053d3e-20ec-4870-b5e9-e675d5414444"
const assetId = "1596d8b6-c75c-43a4-9505-497f31f1ad80"
const sameItemAssetId = "2596d8b6-c75c-43a4-9505-497f31f1ad81"
const otherAssetId = "3596d8b6-c75c-43a4-9505-497f31f1ad82"
const digest = "1".repeat(64)
const secondDigest = "2".repeat(64)

const mediaTypes = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"audio/mpeg",
	"audio/aac",
	"model/gltf-binary",
	"model/gltf+json",
	"model/vnd.usdz+zip",
] as const

const roles = ["obverse", "reverse", "edge", "texture", "audio", "animation"] as const

let admin: pg.Client | undefined
let pool: pg.Pool | undefined

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

function requirePostgres(): pg.Pool {
	if (!pool) throw new Error("CM-2 Task 2 requires reachable real PostgreSQL")
	return pool
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
	if (!destructiveOptIn) {
		throw new Error("RUN_CM2_TASK2_DB_MIGRATION_TESTS=true is required")
	}
	await assertDisposablePostgres({
		allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
		databaseUrl: migrationDatabaseUrl,
	})
	if (!sourceUrl) throw new Error("CM2_TASK2_DATABASE_URL is required")

	admin = new pg.Client({ connectionString: sourceUrl.toString() })
	await admin.connect()
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

describe.sequential("single additive CM-2 content-assets migration", () => {
	it("keeps exactly one named CM-2 migration after AN-1", async () => {
		const directories = (await readdir(migrationsFolder, { withFileTypes: true })).filter(
			entry => entry.isDirectory() && entry.name > previousMigrationName
		)
		const names: string[] = []
		for (const directory of directories) {
			try {
				await access(`${migrationsFolder}/${directory.name}/migration.sql`)
				names.push(directory.name)
			} catch {
				// A generator parity probe without SQL is not a migration.
			}
		}
		// CM-2 contributed exactly one migration, and it is the first one after
		// AN-1. Later tickets legitimately append their own after it.
		expect(names.filter(name => name.endsWith("_cm2_content_assets"))).toEqual([migrationName])
		expect(names[0]).toBe(migrationName)
	})

	it("migrates a fresh database twice and seeds two governed item histories", async () => {
		const activePool = requirePostgres()
		const database = drizzle({ client: activePool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })

		await activePool.query(
			`insert into users (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'CM-2 Asset User', 'cm2-asset@example.test', true, now(), now()),
			        ($2, 'CM-2 Other User', 'cm2-other@example.test', true, now(), now())`,
			[actorId, otherActorId]
		)
		await activePool.query(
			`insert into content_item
			 (id, content_type, status, created_by, last_edited_by)
			 values ($1, 'advisory', 'draft', $3, $3),
			        ($2, 'advisory', 'published', $4, $4)`,
			[itemId, otherItemId, actorId, otherActorId]
		)
		await activePool.query(
			`insert into content_version
			 (id, item_id, version_no, status, content_type, title, summary, body, created_by,
			  approved_by, approved_at, published_by, published_at, transition_action)
			 values ($1, $3, 1, 'draft', 'advisory', 'Draft', 'Summary', 'Body', $5,
			         null, null, null, null, null),
			        ($2, $4, 1, 'published', 'advisory', 'Published', 'Summary', 'Body', $6,
			         $6, now(), $6, now(), 'publish')`,
			[draftVersionId, publishedVersionId, itemId, otherItemId, actorId, otherActorId]
		)
		await activePool.query(
			"update content_item set current_working_version_id = $1 where id = $2",
			[draftVersionId, itemId]
		)
		await activePool.query(
			"update content_item set current_published_version_id = $1 where id = $2",
			[publishedVersionId, otherItemId]
		)

		const tables = await activePool.query<{ table_name: string }>(`
			select table_name from information_schema.tables
			where table_schema = 'public' and table_name in ('asset', 'asset_object', 'version_asset')
			order by table_name
		`)
		expect(tables.rows.map(row => row.table_name)).toEqual([
			"asset",
			"asset_object",
			"version_asset",
		])
	})

	it("accepts every canonical MIME and enforces digest, byte, body, and metadata integrity", async () => {
		const activePool = requirePostgres()
		for (let index = 0; index < mediaTypes.length; index += 1) {
			await activePool.query(
				`insert into asset_object (sha256, byte_length, media_type, body)
				 values ($1, 1, $2, decode('00', 'hex'))`,
				[String(index + 1).repeat(64), mediaTypes[index]]
			)
		}
		const stored = await activePool.query<{ media_type: string }>(
			'select media_type from asset_object order by media_type collate "C"'
		)
		expect(stored.rows.map(row => row.media_type)).toEqual([...mediaTypes].sort())

		for (const [mediaType, maximumBytes, digestCharacter] of [
			["image/png", 10_485_760, "a"],
			["audio/mpeg", 26_214_400, "b"],
			["model/gltf-binary", 52_428_800, "c"],
		] as const) {
			await expectAccepted(
				activePool,
				`insert into asset_object (sha256, byte_length, media_type, body)
				 values ($1, $2, $3, decode(repeat('00', $2), 'hex'))`,
				[digestCharacter.repeat(64), maximumBytes, mediaType]
			)
			await expectRejected(
				activePool,
				`insert into asset_object (sha256, byte_length, media_type, body)
				 values ($1, $2, $3, decode(repeat('00', $2), 'hex'))`,
				"asset_object_size_check",
				[`${digestCharacter.repeat(63)}0`, maximumBytes + 1, mediaType]
			)
		}
		await expectRejected(
			activePool,
			"insert into asset_object values ($1, 1, 'image/png', decode('00', 'hex'), now())",
			"asset_object_sha256_check",
			["A".repeat(64)]
		)
		await expectRejected(
			activePool,
			`insert into asset_object (sha256, byte_length, media_type, body)
			 values ($1, 0, 'image/png', ''::bytea)`,
			"asset_object_size_check",
			["d".repeat(64)]
		)
		await expectRejected(
			activePool,
			`insert into asset_object (sha256, byte_length, media_type, body)
			 values ($1, 2, 'image/png', decode('00', 'hex'))`,
			"asset_object_body_length_check",
			["e".repeat(64)]
		)
		await expectRejected(
			activePool,
			`insert into asset_object (sha256, byte_length, media_type, body)
			 values ($1, 1, 'text/html', decode('00', 'hex'))`,
			"asset_object_media_type_check",
			["f".repeat(64)]
		)
	}, 30_000)

	it("enforces asset metadata ownership, positive versions, and paired tombstones", async () => {
		const activePool = requirePostgres()
		await activePool.query(
			`insert into asset
			 (id, content_item_id, sha256, byte_length, media_type, uploaded_by)
			 values ($1, $2, $3, 1, 'image/png', $4),
			        ($5, $2, $6, 1, 'image/jpeg', $4),
			        ($7, $8, $6, 1, 'image/jpeg', $9)`,
			[
				assetId,
				itemId,
				digest,
				actorId,
				sameItemAssetId,
				secondDigest,
				otherAssetId,
				otherItemId,
				otherActorId,
			]
		)
		await expectRejected(
			activePool,
			`insert into asset
			 (content_item_id, sha256, byte_length, media_type, uploaded_by)
			 values ($1, $2, 2, 'image/png', $3)`,
			"asset_object_metadata_fkey",
			[itemId, digest, actorId]
		)
		await expectRejected(
			activePool,
			`insert into asset
			 (content_item_id, sha256, byte_length, media_type, version, uploaded_by)
			 values ($1, $2, 1, 'image/png', 0, $3)`,
			"asset_version_check",
			[itemId, digest, actorId]
		)
		await expectRejected(
			activePool,
			`insert into asset
			 (content_item_id, sha256, byte_length, media_type, uploaded_by, deleted_at)
			 values ($1, $2, 1, 'image/png', $3, now())`,
			"asset_deletion_pair_check",
			[itemId, digest, actorId]
		)
	})

	it("accepts every role while preventing cross-item attachment and role duplication", async () => {
		const activePool = requirePostgres()
		for (const role of roles) {
			await expectAccepted(
				activePool,
				`insert into version_asset (content_item_id, content_version_id, asset_id, role)
				 values ($1, $2, $3, $4)`,
				[itemId, draftVersionId, assetId, role]
			)
		}
		await expectRejected(
			activePool,
			`insert into version_asset (content_item_id, content_version_id, asset_id, role)
			 values ($1, $2, $3, 'thumbnail')`,
			"version_asset_role_check",
			[itemId, draftVersionId, assetId]
		)
		await activePool.query(
			`insert into version_asset (content_item_id, content_version_id, asset_id, role)
			 values ($1, $2, $3, 'obverse')`,
			[itemId, draftVersionId, assetId]
		)
		await expectRejected(
			activePool,
			`insert into version_asset (content_item_id, content_version_id, asset_id, role)
			 values ($1, $2, $3, 'reverse')`,
			"version_asset_asset_item_fkey",
			[itemId, draftVersionId, otherAssetId]
		)
		await expectRejected(
			activePool,
			`insert into version_asset (content_item_id, content_version_id, asset_id, role)
			 values ($1, $2, $3, 'obverse')`,
			"version_asset_pkey",
			[itemId, draftVersionId, sameItemAssetId]
		)
		await activePool.query(
			`insert into version_asset (content_item_id, content_version_id, asset_id, role)
			 values ($1, $2, $3, 'reverse')`,
			[otherItemId, publishedVersionId, otherAssetId]
		)
	})

	it("installs lookup indexes, restrictive ownership FKs, and immutable triggers", async () => {
		const activePool = requirePostgres()
		const indexes = await activePool.query<{ indexname: string }>(`
			select indexname from pg_indexes
			where schemaname = 'public' and indexname in (
			  'asset_active_content_item_created_idx', 'asset_content_item_created_idx', 'asset_sha256_idx',
			  'version_asset_asset_idx', 'version_asset_content_item_version_idx'
			) order by indexname
		`)
		expect(indexes.rows.map(row => row.indexname)).toEqual([
			"asset_active_content_item_created_idx",
			"asset_content_item_created_idx",
			"asset_sha256_idx",
			"version_asset_asset_idx",
			"version_asset_content_item_version_idx",
		])

		const activeIndex = await activePool.query<{ indexname: string; predicate: string }>(`
			select index_class.relname indexname, pg_get_expr(index.indpred, index.indrelid) predicate
			from pg_index index
			join pg_class index_class on index_class.oid = index.indexrelid
			join pg_namespace namespace on namespace.oid = index_class.relnamespace
			where namespace.nspname = 'public'
			  and index_class.relname = 'asset_active_content_item_created_idx'
		`)
		expect(
			activeIndex.rows.map(row => ({
				indexname: row.indexname,
				predicate: row.predicate
					.replace(/^\((.*)\)$/, "$1")
					.replace(/\s+/g, " ")
					.trim()
					.toLowerCase(),
			}))
		).toEqual([
			{
				indexname: "asset_active_content_item_created_idx",
				predicate: "deleted_at is null",
			},
		])

		const foreignKeys = await activePool.query<{ conname: string; delete_rule: string }>(`
			select c.conname, rc.delete_rule
			from pg_constraint c
			join information_schema.referential_constraints rc
			  on rc.constraint_schema = 'public' and rc.constraint_name = c.conname
			where c.conname in (
			  'asset_content_item_id_content_item_id_fkey',
			  'asset_uploaded_by_users_id_fkey', 'asset_deleted_by_users_id_fkey',
			  'asset_object_metadata_fkey', 'version_asset_content_item_version_fkey',
			  'version_asset_asset_item_fkey'
			) order by c.conname
		`)
		expect(foreignKeys.rows).toEqual([
			{ conname: "asset_content_item_id_content_item_id_fkey", delete_rule: "RESTRICT" },
			{ conname: "asset_deleted_by_users_id_fkey", delete_rule: "RESTRICT" },
			{ conname: "asset_object_metadata_fkey", delete_rule: "RESTRICT" },
			{ conname: "asset_uploaded_by_users_id_fkey", delete_rule: "RESTRICT" },
			{ conname: "version_asset_asset_item_fkey", delete_rule: "RESTRICT" },
			{ conname: "version_asset_content_item_version_fkey", delete_rule: "RESTRICT" },
		])

		const triggers = await activePool.query<{ tgname: string }>(`
			select tgname from pg_trigger
			where not tgisinternal and tgname in (
			  'asset_object_immutable_trigger', 'asset_immutable_trigger',
			  'version_asset_immutable_trigger'
			) order by tgname
		`)
		expect(triggers.rows.map(row => row.tgname)).toEqual([
			"asset_immutable_trigger",
			"asset_object_immutable_trigger",
			"version_asset_immutable_trigger",
		])
	})

	it("makes objects and attachments immutable while allowing one irreversible asset tombstone", async () => {
		const activePool = requirePostgres()
		await expectRejected(
			activePool,
			"update asset_object set media_type = 'image/webp' where sha256 = $1",
			/immutable asset_object/i,
			[digest]
		)
		await expectRejected(
			activePool,
			"delete from asset_object where sha256 = $1",
			/immutable asset_object/i,
			[digest]
		)
		await expectRejected(
			activePool,
			"update version_asset set role = 'reverse' where content_version_id = $1",
			/immutable version_asset/i,
			[draftVersionId]
		)
		await expectRejected(
			activePool,
			"delete from version_asset where content_version_id = $1",
			/immutable version_asset/i,
			[draftVersionId]
		)
		await expectRejected(
			activePool,
			"update asset set version = 2 where id = $1",
			/immutable asset metadata/i,
			[assetId]
		)

		await activePool.query("update asset set deleted_at = now(), deleted_by = $2 where id = $1", [
			assetId,
			actorId,
		])
		const tombstone = await activePool.query<{ deleted: boolean; deleted_by: string }>(
			"select deleted_at is not null deleted, deleted_by from asset where id = $1",
			[assetId]
		)
		expect(tombstone.rows).toEqual([{ deleted: true, deleted_by: actorId }])
		await expectRejected(
			activePool,
			"update asset set deleted_at = null, deleted_by = null where id = $1",
			/immutable asset metadata/i,
			[assetId]
		)
		await expectRejected(
			activePool,
			"update asset set deleted_by = $2 where id = $1",
			/immutable asset metadata/i,
			[assetId, otherActorId]
		)
		await expectRejected(
			activePool,
			"delete from asset where id = $1",
			/immutable asset metadata/i,
			[assetId]
		)
	})
})
