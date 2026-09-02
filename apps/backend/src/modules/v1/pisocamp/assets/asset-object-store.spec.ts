import { resolve } from "node:path"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import { assetObjects, schema } from "@repo/db/schema"

import type { PreparedAssetUpload } from "./asset-file-policy"
import { AssetObjectCorruptionError, PostgresAssetObjectStore } from "./asset-object-store"

const databaseUrl = process.env.CM2_TASK4_DATABASE_URL
const describePostgres = databaseUrl ? describe : describe.skip

function prepared(bytes = Buffer.from("cm2 immutable object", "utf8")): PreparedAssetUpload {
	return {
		bytes,
		byteLength: bytes.length,
		file: new File([bytes], "asset", { type: "model/gltf+json" }),
		mediaType: "model/gltf+json",
		sha256: "0".repeat(64),
	}
}

describePostgres("PostgresAssetObjectStore", () => {
	const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
	const database = drizzle({ client: pool, schema })
	const store = new PostgresAssetObjectStore()

	beforeAll(async () => {
		await migrate(database, {
			migrationsFolder: resolve(__dirname, "../../../../../../../packages/db/src/migrations"),
		})
	})

	beforeEach(async () => {
		await database.execute(sql.raw('truncate table "asset_object" cascade'))
	})

	afterAll(async () => {
		await database.execute(sql.raw('truncate table "asset_object" cascade'))
		await pool.end()
	})

	it("recomputes the digest and rejects caller metadata before persistence", async () => {
		await expect(store.putVerified(database as never, prepared())).rejects.toMatchObject({
			code: "store_digest_mismatch",
		})
		expect(await database.select().from(assetObjects)).toHaveLength(0)
	})

	it("deduplicates a verified immutable object and verifies persisted read-back", async () => {
		const bytes = Buffer.from("cm2 immutable object", "utf8")
		const input = prepared(bytes)
		input.sha256 = "aded77ac95ded11d933e70593cf04ae775916e1b90043e1f232ca8d49fb07a4c"

		const first = await store.putVerified(database as never, input)
		const second = await store.putVerified(database as never, input)

		expect(first).toEqual(second)
		expect(first).toEqual({
			sha256: input.sha256,
			byteLength: bytes.length,
			mediaType: "model/gltf+json",
			bytes,
		})
		expect(await database.select().from(assetObjects)).toHaveLength(1)
	})

	it("detects persisted byte corruption during read-back", async () => {
		const bytes = Buffer.from("cm2 immutable object", "utf8")
		const input = prepared(bytes)
		input.sha256 = "aded77ac95ded11d933e70593cf04ae775916e1b90043e1f232ca8d49fb07a4c"
		await store.putVerified(database as never, input)

		await database.execute(sql.raw('alter table "asset_object" disable trigger user'))
		try {
			await database
				.update(assetObjects)
				.set({ body: Buffer.alloc(bytes.length, 0x78) })
				.where(eq(assetObjects.sha256, input.sha256))
		} finally {
			await database.execute(sql.raw('alter table "asset_object" enable trigger user'))
		}

		await expect(store.readByDigest(database as never, input.sha256)).rejects.toBeInstanceOf(
			AssetObjectCorruptionError
		)
	})

	it("rolls back a stored object with its propagated PostgreSQL transaction", async () => {
		const bytes = Buffer.from("transactional cm2 object", "utf8")
		const input = prepared(bytes)
		input.sha256 = "1182fbfb0297bb4ec4f0c0ad95915244d6b80ff435a6b86668f1f2d3bc2e8595"

		await expect(
			database.transaction(async tx => {
				await store.putVerified(tx as never, input)
				throw new Error("rollback sentinel")
			})
		).rejects.toThrow("rollback sentinel")

		expect(
			await database.select().from(assetObjects).where(eq(assetObjects.sha256, input.sha256))
		).toHaveLength(0)
	})
})
