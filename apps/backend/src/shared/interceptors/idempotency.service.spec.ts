import { resolve } from "node:path"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import { idempotencyKeys, moduleConfiguration } from "@repo/db/schema"

import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { IdempotencyService, requireMatchingRequestId, type JsonValue } from "./idempotency.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
}))

const AUTHOR_A = "cm2-task3-idempotency-a"
const AUTHOR_B = "cm2-task3-idempotency-b"
const REQUEST_ID = "ea4cb048-e51b-49ab-b9b4-e9813dc70cb2"
const OTHER_REQUEST_ID = "662d8905-46ea-45ce-8dbc-c4de7156ec42"
const UPLOAD_PATH = "/admin/pisocamp/assets"
const ROLLBACK_CONFIGURATION_KEY = "cm2-task3-idempotency-rollback"
const FAILURE_TRIGGER = "cm2_task3_fail_idempotency"
const FAILURE_FUNCTION = "cm2_task3_fail_idempotency_fn"
const expectedDatabaseName =
	process.env.CM2_TASK3_EXPECTED_DATABASE_NAME ?? "cm2_task3_idempotency_test"
const databaseTestsEnabled = process.env.RUN_DB_IDEMPOTENCY_TESTS === "1"
const itDb: jest.It = databaseTestsEnabled ? it : it.skip

const service = new IdempotencyService()

function uploadInput(fileSha256 = "a".repeat(64)) {
	return {
		fileSha256,
		itemId: "bb303323-2055-4532-8497-1daf9911315b",
		expectedVersionNo: 3,
		role: "obverse",
		requestId: REQUEST_ID,
	}
}

function operation<T extends JsonValue>(
	input: unknown,
	run: () => Promise<T>,
	authorId = AUTHOR_A
) {
	return {
		authorId,
		key: REQUEST_ID,
		method: "POST",
		path: UPLOAD_PATH,
		input,
		run,
	}
}

async function clearTaskRows(): Promise<void> {
	await db.execute(sql.raw(`drop trigger if exists "${FAILURE_TRIGGER}" on "idempotency_keys"`))
	await db.execute(sql.raw(`drop function if exists "${FAILURE_FUNCTION}"()`))
	await db
		.delete(idempotencyKeys)
		.where(sql`${idempotencyKeys.authorId} in (${AUTHOR_A}, ${AUTHOR_B})`)
	await db
		.delete(moduleConfiguration)
		.where(eq(moduleConfiguration.key, ROLLBACK_CONFIGURATION_KEY))
}

beforeAll(async () => {
	if (!databaseTestsEnabled) return
	const target = assertDisposablePostgres({
		allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
		databaseUrl: process.env.DATABASE_URL,
	})
	expect(target).toEqual({ host: "127.0.0.1", databaseName: expectedDatabaseName })

	const migrationPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
	await migrate(drizzle({ client: migrationPool }), {
		migrationsFolder: resolve(__dirname, "../../../../../packages/db/src/migrations"),
	})
	await migrationPool.end()
	await clearTaskRows()
})

beforeEach(async () => {
	if (!databaseTestsEnabled) return
	await clearTaskRows()
})

afterAll(async () => {
	if (!databaseTestsEnabled) return
	await clearTaskRows()
	await db.$client.end()
})

describe("requireMatchingRequestId", () => {
	it.each([
		["a missing header", undefined],
		["multiple header values", [REQUEST_ID]],
	])("rejects %s with the existing required-header message", (_label, rawKey) => {
		expect(() => requireMatchingRequestId(rawKey, REQUEST_ID)).toThrow(
			"Idempotency-Key is required"
		)
	})

	it("rejects a non-UUID header with the existing safe message", () => {
		expect(() => requireMatchingRequestId("not-a-uuid", "not-a-uuid")).toThrow(
			"Idempotency-Key must be a UUID"
		)
	})

	it("rejects a UUID that differs from the request id", () => {
		expect(() => requireMatchingRequestId(REQUEST_ID, OTHER_REQUEST_ID)).toThrow(
			"Idempotency-Key must match the request id"
		)
	})

	it("returns the single UUID when it matches the request id", () => {
		expect(requireMatchingRequestId(REQUEST_ID, REQUEST_ID)).toBe(REQUEST_ID)
	})
})

describe("IdempotencyService", () => {
	itDb(
		"canonically fingerprints requests and enforces the deterministic JSON response boundary",
		async () => {
			const run = jest.fn().mockResolvedValue({ assetId: "asset-first", versionNo: 4 })
			const first = await service.execute(operation(uploadInput(), run))

			const replayRun = jest.fn().mockResolvedValue({ assetId: "must-not-run", versionNo: 5 })
			const replayInput = {
				requestId: REQUEST_ID,
				role: "obverse",
				expectedVersionNo: 3,
				itemId: "bb303323-2055-4532-8497-1daf9911315b",
				fileSha256: "a".repeat(64),
			}
			const replay = await service.execute(operation(replayInput, replayRun))

			expect(first).toEqual({ assetId: "asset-first", versionNo: 4 })
			expect(replay).toEqual(first)
			expect(run).toHaveBeenCalledTimes(1)
			expect(replayRun).not.toHaveBeenCalled()

			const jsonResponses = [
				["102e4fab-1f62-4256-bb1d-592ed6299bca", "text"],
				["9beba142-ff64-42eb-a292-0ed4610a70ba", 42],
				["4a4bddb2-f00b-4507-8924-f83283bd3ab4", true],
				["73093e2f-3de5-4aa8-8afd-178cf37f0068", null],
			] as const
			for (const [key, value] of jsonResponses) {
				await expect(
					service.execute({ ...operation(uploadInput(), async () => value), key })
				).resolves.toBe(value)
			}

			const nestedKey = "f185dcf5-934a-43cf-aa61-b35586666568"
			const nested = await service.execute({
				...operation(uploadInput(), async () => ({
					z: [{ d: 4, c: null }, false],
					a: { b: "two", a: 1 },
				})),
				key: nestedKey,
			})
			expect(JSON.stringify(nested)).toBe('{"a":{"a":1,"b":"two"},"z":[{"c":null,"d":4},false]}')
			const nestedReplay = await service.execute({
				...operation(uploadInput(), async () => ({ unreachable: true })),
				key: nestedKey,
			})
			expect(JSON.stringify(nestedReplay)).toBe(JSON.stringify(nested))

			class UnsupportedResponse {
				constructor(readonly value: string) {}
			}
			const unsupported = [
				["0a67991a-130a-42a1-842d-998de84a9a41", undefined],
				["cc8db19a-e1ec-4ce9-aaef-991b49833801", { value: undefined }],
				["b08aa648-ae63-405d-b558-1f10b68366fc", [undefined]],
				["00828d91-074c-484a-bd4b-f33b67c445d1", new Date("2026-09-01T00:00:00Z")],
				["8528e296-a8b9-4cf4-9fbc-2a96c53d7219", Number.NaN],
				["ff984d7c-5a04-41a6-9820-6af9b19ff1ab", Number.POSITIVE_INFINITY],
				["64d95f0e-ec39-4cf1-85f0-199864827042", new UnsupportedResponse("secret")],
			] as const
			for (const [key, value] of unsupported) {
				await expect(
					service.execute({
						...operation(uploadInput(), async () => value as never),
						key,
					})
				).rejects.toMatchObject({
					code: "INTERNAL_SERVER_ERROR",
					message: "Idempotent response is not JSON-compatible",
				})
			}
		}
	)

	itDb("rejects the same live key with a different upload fingerprint", async () => {
		await service.execute(operation(uploadInput(), async () => ({ generation: 1 })))
		const conflictingRun = jest.fn().mockResolvedValue({ generation: 2 })

		await expect(
			service.execute(operation(uploadInput("b".repeat(64)), conflictingRun))
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Idempotency-Key was already used for a different request",
		})
		expect(conflictingRun).not.toHaveBeenCalled()
	})

	itDb.each([
		["method", "DELETE", UPLOAD_PATH],
		["path", "POST", "/admin/pisocamp/assets/other"],
	])("binds the fingerprint to the operation %s", async (_label, method, path) => {
		await service.execute(operation(uploadInput(), async () => ({ generation: 1 })))
		const conflictingRun = jest.fn().mockResolvedValue({ generation: 2 })

		await expect(
			service.execute({ ...operation(uploadInput(), conflictingRun), method, path })
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(conflictingRun).not.toHaveBeenCalled()
	})

	itDb("replaces an expired row with a fresh execution and TTL", async () => {
		await service.execute(operation(uploadInput(), async () => ({ generation: 1 })))
		await db
			.update(idempotencyKeys)
			.set({ expiresAt: new Date(Date.now() - 1_000) })
			.where(and(eq(idempotencyKeys.authorId, AUTHOR_A), eq(idempotencyKeys.key, REQUEST_ID)))

		const before = Date.now()
		const freshRun = jest.fn().mockResolvedValue({ generation: 2 })
		const fresh = await service.execute(operation(uploadInput("c".repeat(64)), freshRun))
		const [replacement] = await db
			.select()
			.from(idempotencyKeys)
			.where(and(eq(idempotencyKeys.authorId, AUTHOR_A), eq(idempotencyKeys.key, REQUEST_ID)))

		expect(fresh).toEqual({ generation: 2 })
		expect(freshRun).toHaveBeenCalledTimes(1)
		expect(replacement?.response).toEqual({ generation: 2 })
		expect(replacement?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 86_400_000)
	})

	itDb("isolates the same key between two authors", async () => {
		const first = await service.execute(
			operation(uploadInput(), async () => ({ owner: "A" }), AUTHOR_A)
		)
		const second = await service.execute(
			operation(uploadInput(), async () => ({ owner: "B" }), AUTHOR_B)
		)

		expect(first).toEqual({ owner: "A" })
		expect(second).toEqual({ owner: "B" })
		const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, REQUEST_ID))
		expect(rows.map(row => row.authorId).sort()).toEqual([AUTHOR_A, AUTHOR_B])
	})

	itDb("serializes concurrent duplicates and executes one operation", async () => {
		let executionCount = 0
		const execute = (label: string) =>
			service.execute(
				operation(uploadInput(), async () => {
					executionCount += 1
					await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
					return { label }
				})
			)

		const [first, second] = await Promise.all([execute("first"), execute("second")])

		expect(executionCount).toBe(1)
		expect(first).toEqual(second)
	})

	itDb("rolls back joined domain work when response persistence fails", async () => {
		await db.execute(
			sql.raw(
				`create function "${FAILURE_FUNCTION}"() returns trigger language plpgsql as $$ begin raise exception 'forced idempotency persistence failure'; end $$`
			)
		)
		await db.execute(
			sql.raw(
				`create trigger "${FAILURE_TRIGGER}" before insert on "idempotency_keys" for each row execute function "${FAILURE_FUNCTION}"()`
			)
		)

		await expect(
			service.execute(
				operation(uploadInput(), () =>
					databaseTransactionContext.transaction(async tx => {
						await tx.insert(moduleConfiguration).values({
							key: ROLLBACK_CONFIGURATION_KEY,
							value: { mustRollback: true },
						})
						return { ok: true }
					})
				)
			)
		).rejects.toThrow()

		expect(
			await db
				.select()
				.from(moduleConfiguration)
				.where(eq(moduleConfiguration.key, ROLLBACK_CONFIGURATION_KEY))
		).toHaveLength(0)
		expect(
			await db
				.select()
				.from(idempotencyKeys)
				.where(and(eq(idempotencyKeys.authorId, AUTHOR_A), eq(idempotencyKeys.key, REQUEST_ID)))
		).toHaveLength(0)
	})
})
