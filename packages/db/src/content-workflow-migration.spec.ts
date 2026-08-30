import "dotenv/config"

import { readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest"

const previousMigrationName = "20260825092716_cm1_content_foundation"
const migrationName = "20260826105155_cm3_content_workflow_foundation"
const requiredAdminDatabase = "cm3_task2_admin"
const databaseName = `cm3_content_workflow_${process.pid}`
const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url))
const destructiveOptIn = process.env.RUN_CM3_DB_MIGRATION_TESTS === "true"
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined

const actorId = "cm3-workflow-migration-user"
const itemId = "8fbf8bd8-b52e-4689-8bad-dd3b0d7d1111"
const otherItemId = "e25dcc5c-b1eb-41df-b32b-14139e6a2222"
const draftVersionId = "5d7386c9-2190-4321-b52c-c350828e1111"
const submittedVersionId = "027a9296-f9e1-4f0e-8d35-872b188e2222"
const approvedVersionId = "b456ca62-18dd-48fb-9cd1-73d341c33333"
const publishedVersionId = "e6053d3e-20ec-4870-b5e9-e675d5414444"
const secondPublishedVersionId = "84a40169-bb61-4bf9-8afd-e89b10a95555"
const requestId = "68c9dd1d-284e-4974-af97-40d8d3ed1111"
const secondRequestId = "e152aed6-6de1-46e4-9e47-53beaf142222"
const terminalPublishedVersionId = "29b46c28-00b8-4b45-9f50-9a6868a66666"
const terminalRequestId = "61595479-66a4-47c6-8192-d77c583b3333"
const processedBundleId = "f10aeaa7-acde-4fd6-9840-8144c91f7777"

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

beforeAll(async () => {
	if (!destructiveOptIn) {
		unavailableReason = "RUN_CM3_DB_MIGRATION_TESTS=true is required"
		if (process.env.CI === "true") throw new Error(unavailableReason)
		return
	}
	if (!sourceUrl) throw new Error("DATABASE_URL is required after destructive-test opt-in")
	if (!new Set(["127.0.0.1", "localhost", "::1"]).has(sourceUrl.hostname)) {
		throw new Error("CM-3 migration tests require a loopback DATABASE_URL")
	}
	if (sourceUrl.pathname !== `/${requiredAdminDatabase}`) {
		throw new Error(`CM-3 migration tests require the dedicated ${requiredAdminDatabase} database`)
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

describe.sequential("single additive CM-3 content workflow migration", () => {
	it("keeps exactly one named CM-3 migration", async () => {
		const names = (await readdir(migrationsFolder, { withFileTypes: true }))
			.filter(
				entry =>
					entry.isDirectory() && entry.name > previousMigrationName && entry.name === migrationName
			)
			.map(entry => entry.name)
		expect(names).toEqual([migrationName])
	})

	it("migrates a fresh dedicated database and safely reapplies the runner", async context => {
		const activePool = requirePostgres(context)
		const database = drizzle({ client: activePool })
		await migrate(database, { migrationsFolder })
		await migrate(database, { migrationsFolder })
		await activePool.query(
			`insert into users (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'CM-3 User', 'cm3-workflow@example.test', true, now(), now())`,
			[actorId]
		)
		await activePool.query(
			`insert into content_item
			 (id, content_type, status, created_by, last_edited_by)
			 values ($1, 'advisory', 'published', $3, $3),
			        ($2, 'advisory', 'draft', $3, $3)`,
			[itemId, otherItemId, actorId]
		)
		await activePool.query(
			`insert into content_version
			 (id, item_id, version_no, parent_version_id, status, content_type, title, summary,
			  body, created_by, approved_by, approved_at, published_by, published_at,
			  transition_action, transition_comments)
			 values
			 ($1, $6, 1, null, 'draft', 'advisory', 'Draft', 'Summary', 'Body', $7,
			  null, null, null, null, null, null),
			 ($2, $6, 2, $1, 'submitted_for_review', 'advisory', 'Submitted', 'Summary', 'Body', $7,
			  null, null, null, null, 'submit', null),
			 ($3, $6, 3, $2, 'approved', 'advisory', 'Approved', 'Summary', 'Body', $7,
			  $7, now(), null, null, 'approve', 'Reviewed against source.'),
			 ($4, $6, 4, $3, 'published', 'advisory', 'Published', 'Summary', 'Body', $7,
			  $7, now(), $7, now(), 'publish', null),
			 ($5, $6, 5, $4, 'published', 'advisory', 'Published again', 'Summary', 'Body', $7,
			  $7, now(), $7, now(), 'publish', 'Republished after review.')`,
			[
				draftVersionId,
				submittedVersionId,
				approvedVersionId,
				publishedVersionId,
				secondPublishedVersionId,
				itemId,
				actorId,
			]
		)
		await activePool.query(
			`insert into content_bundle
			 (id, state, manifest_payload, manifest_sha256, algorithm, key_id, signature, ready_at)
			 values ($1, 'ready', 'e30', $2, 'Ed25519', 'ce1-test-v1', $3, now())`,
			[processedBundleId, "a".repeat(64), "A".repeat(86)]
		)
	})

	it("defaults new items to no pending bundle rebuild", async context => {
		const activePool = requirePostgres(context)
		const result = await activePool.query<{ bundle_pending: boolean }>(
			"select bundle_pending from content_item where id = $1",
			[otherItemId]
		)
		expect(result.rows).toEqual([{ bundle_pending: false }])
	})

	it("adds a nullable hashed idempotency fingerprint without invalidating legacy rows", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into idempotency_keys
			 (author_id, key, request_fingerprint, response, expires_at)
			 values ($1, 'cm3-legacy-key', null, '{"legacy":true}'::jsonb, now() + interval '1 hour')`,
			[actorId]
		)
		const legacy = await activePool.query<{ request_fingerprint: string | null }>(
			"select request_fingerprint from idempotency_keys where author_id = $1 and key = 'cm3-legacy-key'",
			[actorId]
		)
		expect(legacy.rows).toEqual([{ request_fingerprint: null }])

		await expectRejected(
			activePool,
			`insert into idempotency_keys
			 (author_id, key, request_fingerprint, response, expires_at)
			 values ($1, 'cm3-invalid-fingerprint', 'raw payload', '{}'::jsonb, now() + interval '1 hour')`,
			"idempotency_keys_request_fingerprint_check",
			[actorId]
		)
	})

	it("enforces transition action, comments, and lifecycle correlation", async context => {
		const activePool = requirePostgres(context)
		const base = `insert into content_version
			(item_id, version_no, status, content_type, title, summary, body, created_by,
			 approved_by, approved_at, published_by, published_at, transition_action, transition_comments)`

		await expectRejected(
			activePool,
			`${base} values ($1, 10, 'draft', 'advisory', 'Title', 'Summary', 'Body', $2,
			 null, null, null, null, 'archive', null)`,
			"content_version_transition_action_check",
			[otherItemId, actorId]
		)
		for (const comments of [" padded", "padded ", "<b>reviewed</b>", "", "x".repeat(2001)]) {
			await expectRejected(
				activePool,
				`${base} values ($1, 10, 'draft', 'advisory', 'Title', 'Summary', 'Body', $2,
				 null, null, null, null, 'reject', $3)`,
				"content_version_transition_comments_check",
				[otherItemId, actorId, comments]
			)
		}
		for (const [status, action, comments] of [
			["submitted_for_review", "approve", "Reviewed"],
			["approved", "approve", null],
			["draft", "submit", null],
			["published", "publish", null],
		] as const) {
			await expectRejected(
				activePool,
				`${base} values ($1, 10, $3, 'advisory', 'Title', 'Summary', 'Body', $2,
				 null, null, null, null, $4, $5)`,
				/content_version_(lifecycle_fields|transition_lifecycle)_check/,
				[otherItemId, actorId, status, action, comments]
			)
		}
	})

	it("allows null transition metadata only for draft create or edit snapshots", async context => {
		const activePool = requirePostgres(context)
		const base = `insert into content_version
			(item_id, version_no, status, content_type, title, summary, body, created_by,
			 approved_by, approved_at, published_by, published_at, transition_action, transition_comments)`
		for (const [status, approvalMetadata, publicationMetadata] of [
			["submitted_for_review", "null, null", "null, null"],
			["approved", "$2, now()", "null, null"],
			["published", "$2, now()", "$2, now()"],
		] as const) {
			await expectRejected(
				activePool,
				`${base} values ($1, 20, '${status}', 'advisory', 'Title', 'Summary', 'Body', $2,
				 ${approvalMetadata}, ${publicationMetadata}, null, null)`,
				"content_version_transition_lifecycle_check",
				[otherItemId, actorId]
			)
		}
	})

	it("preserves immutable content versions and related links", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into related_link
			 (content_version_id, position, kind, label, external_url)
			 values ($1, 0, 'external', 'BSP', 'https://www.bsp.gov.ph/')`,
			[publishedVersionId]
		)
		await expectRejected(
			activePool,
			"update content_version set transition_comments = 'Changed' where id = $1",
			/immutable content_version/i,
			[publishedVersionId]
		)
		await expectRejected(
			activePool,
			"delete from related_link where content_version_id = $1",
			/immutable related_link/i,
			[publishedVersionId]
		)
	})

	it("accepts only same-item published transition versions and one request per version", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[requestId, itemId, publishedVersionId]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_rebuild_request (item_id, published_version_id)
			 values ($1, $2)`,
			"content_bundle_rebuild_request_item_version_fkey",
			[otherItemId, secondPublishedVersionId]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_rebuild_request (item_id, published_version_id)
			 values ($1, $2)`,
			/only a published transition version/i,
			[itemId, approvedVersionId]
		)
		await expectRejected(
			activePool,
			`insert into content_bundle_rebuild_request (item_id, published_version_id)
			 values ($1, $2)`,
			"content_bundle_rebuild_request_published_version_unique",
			[itemId, publishedVersionId]
		)
	})

	it("permits retry delivery progression while rejecting illegal state and payload changes", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[secondRequestId, itemId, secondPublishedVersionId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'completed', attempt_count = 1, last_attempt_at = now(), processed_at = now()
			 where id = $1`,
			/illegal rebuild delivery state transition/i,
			[secondRequestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = now(),
			     lease_owner = 'cm3-worker-1', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			[secondRequestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'failed', last_error = 'builder_unavailable',
			     lease_owner = null, lease_expires_at = null
			 where id = $1`,
			[secondRequestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'pending', available_at = now()
			 where id = $1`,
			[secondRequestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 2, last_attempt_at = now(), last_error = null,
			     lease_owner = 'cm3-worker-2', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			[secondRequestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'completed', processed_at = now(), processed_bundle_id = $2,
			     lease_owner = null, lease_expires_at = null
			 where id = $1`,
			[secondRequestId, processedBundleId]
		)
		const delivered = await activePool.query(
			`select state, attempt_count, processed_at is not null processed
			 from content_bundle_rebuild_request where id = $1`,
			[secondRequestId]
		)
		expect(delivered.rows).toEqual([{ state: "completed", attempt_count: 2, processed: true }])

		await expectRejected(
			activePool,
			"update content_bundle_rebuild_request set item_id = $2 where id = $1",
			/immutable rebuild request identity/i,
			[requestId, otherItemId]
		)
		await expectRejected(
			activePool,
			"update content_bundle_rebuild_request set attempt_count = 0 where id = $1",
			/terminal completed rebuild request is immutable/i,
			[secondRequestId]
		)
		await expectRejected(
			activePool,
			"update content_bundle_rebuild_request set last_error = '<b>secret</b>' where id = $1",
			/content_bundle_rebuild_request_(last_error|delivery_metadata)_check/,
			[requestId]
		)
		await expectRejected(
			activePool,
			"delete from content_bundle_rebuild_request where id = $1",
			/immutable rebuild request identity/i,
			[requestId]
		)
	})

	it("enforces temporal ordering and terminal delivery immutability", async context => {
		const activePool = requirePostgres(context)
		await activePool.query(
			`insert into content_version
			 (id, item_id, version_no, parent_version_id, status, content_type, title, summary,
			  body, created_by, approved_by, approved_at, published_by, published_at,
			  transition_action, transition_comments)
			 values ($1, $2, 6, $3, 'published', 'advisory', 'Terminal publication', 'Summary',
			         'Body', $4, $4, now(), $4, now(), 'publish', null)`,
			[terminalPublishedVersionId, itemId, secondPublishedVersionId, actorId]
		)
		await activePool.query(
			`insert into content_bundle_rebuild_request (id, item_id, published_version_id)
			 values ($1, $2, $3)`,
			[terminalRequestId, itemId, terminalPublishedVersionId]
		)

		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1,
			     last_attempt_at = created_at - interval '1 second',
			     lease_owner = 'cm3-invalid-worker', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			"content_bundle_rebuild_request_delivery_metadata_check",
			[terminalRequestId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'processing', attempt_count = 1, last_attempt_at = created_at,
			     lease_owner = 'cm3-terminal-worker', lease_expires_at = now() + interval '5 minutes'
			 where id = $1`,
			[terminalRequestId]
		)
		await expectRejected(
			activePool,
			`update content_bundle_rebuild_request
			 set state = 'completed', processed_at = last_attempt_at - interval '1 second',
			     processed_bundle_id = $2, lease_owner = null, lease_expires_at = null
			 where id = $1`,
			"content_bundle_rebuild_request_delivery_metadata_check",
			[terminalRequestId, processedBundleId]
		)
		await activePool.query(
			`update content_bundle_rebuild_request
			 set state = 'completed', processed_at = last_attempt_at, processed_bundle_id = $2,
			     lease_owner = null, lease_expires_at = null
			 where id = $1`,
			[terminalRequestId, processedBundleId]
		)

		for (const assignment of [
			"available_at = available_at + interval '1 second'",
			"last_attempt_at = last_attempt_at + interval '1 second'",
			"processed_at = processed_at + interval '1 second'",
			"last_error = 'Late rewrite'",
			"attempt_count = attempt_count + 1",
		]) {
			await expectRejected(
				activePool,
				`update content_bundle_rebuild_request set ${assignment} where id = $1`,
				/terminal completed rebuild request is immutable/i,
				[terminalRequestId]
			)
		}
	})

	it("installs polling, ownership, uniqueness, and publication enforcement indexes and triggers", async context => {
		const activePool = requirePostgres(context)
		const indexes = await activePool.query<{ indexname: string }>(
			`select indexname from pg_indexes
			 where schemaname = 'public' and indexname in (
			   'content_bundle_rebuild_request_poll_idx',
			   'content_bundle_rebuild_request_item_created_idx',
			   'content_bundle_rebuild_request_published_version_unique'
			 ) order by indexname`
		)
		expect(indexes.rows.map(row => row.indexname)).toEqual([
			"content_bundle_rebuild_request_item_created_idx",
			"content_bundle_rebuild_request_poll_idx",
			"content_bundle_rebuild_request_published_version_unique",
		])
		const triggers = await activePool.query<{ tgname: string }>(
			`select tgname from pg_trigger
			 where not tgisinternal and tgname in (
			   'content_bundle_rebuild_request_published_version_trigger',
			   'content_bundle_rebuild_request_immutable_trigger'
			 ) order by tgname`
		)
		expect(triggers.rows.map(row => row.tgname)).toEqual([
			"content_bundle_rebuild_request_immutable_trigger",
			"content_bundle_rebuild_request_published_version_trigger",
		])
	})
})
