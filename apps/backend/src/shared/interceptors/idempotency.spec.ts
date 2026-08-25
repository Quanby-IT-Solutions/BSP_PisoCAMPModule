/**
 * AB-3 / F-13 — idempotency keys are identity-scoped, bounded, and expiring.
 *
 * The interceptor half runs against a real Postgres: the guarantees are a
 * composite primary key, an advisory lock, and an expiry predicate, none of
 * which a mocked db exhibits.
 */

import { and, eq, lt, sql } from "drizzle-orm"
import { of } from "rxjs"

import { idempotencyKeys, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { ExpiryCleanupService } from "@/common/maintenance/expiry-cleanup.service"

import {
	describeIdempotencyKeyProblem,
	IDEMPOTENCY_KEY_MAX_LENGTH,
	IDEMPOTENCY_KEY_MIN_LENGTH,
	validateIdempotencyKey,
} from "./idempotency-key"
import { IdempotencyInterceptor } from "./idempotency.interceptor"

const mockGetSession = jest.fn().mockResolvedValue(null)
const mockIsActive = jest.fn().mockResolvedValue(true)
jest.mock("better-auth/node", () => ({ fromNodeHeaders: jest.fn(headers => headers) }))
jest.mock("@repo/auth", () => ({
	getAuth: jest.fn(() => ({ api: { getSession: mockGetSession } })),
}))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		readonly code: string
		constructor(code: string, options?: { message?: string }) {
			super(options?.message)
			this.code = code
		}
	},
}))

const USER_A = "ab3-user-a"
const USER_B = "ab3-user-b"
const SHARED_KEY = "shared-key-0001"
const GUEST_AUTHOR = "guest:AbCdEfGhIjKlMnOpQrSt_-"

let dbReachable = false

const interceptor = new IdempotencyInterceptor({ isActive: mockIsActive } as never)

beforeEach(() => {
	mockGetSession.mockReset()
	mockGetSession.mockResolvedValue(null)
	mockIsActive.mockReset()
	mockIsActive.mockResolvedValue(true)
})

/** Minimal ExecutionContext carrying a session and an Idempotency-Key. */
function contextFor(authorId: string | null, key?: string, devicePseudoId?: string) {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				headers: {
					...(key ? { "idempotency-key": key } : {}),
					...(devicePseudoId ? { "x-device-pseudo-id": devicePseudoId } : {}),
				},
				session: authorId ? { user: { id: authorId } } : undefined,
			}),
		}),
	} as never
}

/**
 * A stand-in for what an `@Implement()` controller actually returns: an oRPC
 * procedure, not a response. This is the path every mutating route in the app
 * takes, and the one a previous version of the interceptor mishandled — it
 * stored the procedure itself and replayed it, producing a 500.
 *
 * `calls.count` tracks executions of the *business* handler, so "replayed"
 * versus "re-executed" is observable.
 */
function countingHandler(value: unknown, route = { method: "POST", path: "/spec" }) {
	const calls = { count: 0 }

	const procedure = {
		"~orpc": {
			route,
			handler: async () => {
				calls.count++
				return value
			},
		},
	}

	return {
		calls,
		procedure,
		handler: { handle: () => of(procedure) } as never,
	}
}

function countingConsentHandler(value: unknown) {
	const calls = { count: 0 }
	const procedure = {
		"~orpc": {
			route: { method: "POST", path: "/v1/pisocamp/consent" },
			handler: async () => {
				calls.count++
				return value
			},
		},
	}

	return {
		calls,
		procedure,
		handler: { handle: () => of(procedure) } as never,
	}
}

/** Drive the interceptor, then execute the procedure it hands back. */
async function run(
	authorId: string | null,
	key: string | undefined,
	value: unknown,
	options?: {
		devicePseudoId?: string
		input?: unknown
		consentRoute?: boolean
		profileRoute?: boolean
	}
) {
	const { calls, handler } = options?.consentRoute
		? countingConsentHandler(value)
		: countingHandler(
				value,
				options?.profileRoute ? { method: "POST", path: "/v1/pisocamp/profile" } : undefined
			)
	const observable = await interceptor.intercept(
		contextFor(authorId, key, options?.devicePseudoId),
		handler
	)
	const emitted = await new Promise<{ "~orpc": { handler: (o: unknown) => unknown } }>(resolve => {
		observable.subscribe({ next: resolve as (v: unknown) => void })
	})

	// The oRPC adapter invokes the procedure's handler; do the same.
	const result = await emitted["~orpc"].handler({ input: options?.input ?? {}, context: {} })
	return { result, calls }
}

async function cleanup() {
	await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, GUEST_AUTHOR))
	for (const id of [USER_A, USER_B]) {
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, id))
		await db.delete(users).where(eq(users.id, id))
	}
}

beforeAll(async () => {
	try {
		await db.execute(sql`select 1`)
		dbReachable = true
	} catch {
		return
	}
	await cleanup()
	const now = new Date()
	await db.insert(users).values(
		[USER_A, USER_B].map(id => ({
			id,
			name: id,
			email: `${id}@test.local`,
			createdAt: now,
			updatedAt: now,
		}))
	)
})

afterAll(async () => {
	if (!dbReachable) return
	await cleanup()
	await db.$client.end()
})

const itDb: jest.It = ((name: string, fn: jest.ProvidesCallback, timeout?: number) =>
	it(
		name,
		async (...args: unknown[]) => {
			if (!dbReachable) {
				console.warn(`[ab-3] skipped "${name}": no database reachable`)
				return
			}
			return (fn as (...a: unknown[]) => unknown)(...args)
		},
		timeout
	)) as jest.It

describe("key validation (rejects before any write)", () => {
	it("accepts a UUID", () => {
		expect(validateIdempotencyKey("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBeNull()
	})

	it("rejects a key over the cap", () => {
		expect(validateIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toBe("too-long")
	})

	it("accepts a key exactly at the cap", () => {
		expect(validateIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toBeNull()
	})

	it("rejects a key below the floor", () => {
		expect(validateIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1))).toBe("too-short")
	})

	it.each([
		["whitespace", "key with space"],
		["newline (log injection)", "key\nInjected: line"],
		// Escaped, not a literal byte: a raw NUL does not survive a round trip
		// through the file and silently shortens the fixture to a length error.
		["control character", `key${String.fromCharCode(0)}null`],
		["tab", "key	separated"],
		["non-ascii", "kéy-with-accent"],
	])("rejects %s", (_label, key) => {
		expect(validateIdempotencyKey(key)).toBe("malformed")
	})

	it("never echoes the offending value back to the caller", () => {
		// The key reaches logs; reflecting it would carry whatever was sent.
		for (const problem of ["too-short", "too-long", "malformed"] as const) {
			expect(describeIdempotencyKeyProblem(problem)).not.toMatch(/undefined|\bnull\b/)
		}
	})

	itDb("returns 400 and writes nothing for an oversized key", async () => {
		const bad = "a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)
		const { handler, calls } = countingHandler({ ok: true })

		await expect(
			(async () => {
				const observable = await interceptor.intercept(contextFor(USER_A, bad), handler)
				const emitted = await new Promise<{ "~orpc": { handler: (o: unknown) => unknown } }>(
					resolve => observable.subscribe({ next: resolve as (value: unknown) => void })
				)
				return emitted["~orpc"].handler({ input: {}, context: {} })
			})()
		).rejects.toMatchObject({ code: "BAD_REQUEST" })

		// "before any write": the handler never ran and no row was stored.
		expect(calls.count).toBe(0)
		const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))
		expect(rows).toHaveLength(0)
	})
})

describe("keys are scoped to their author (F-13)", () => {
	beforeEach(async () => {
		if (!dbReachable) return
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_B))
	})

	itDb("two users sending the same key both succeed independently", async () => {
		// The squatting case: under the old global primary key, whoever sent the
		// value first owned it and the second user was refused as a duplicate.
		const a = await run(USER_A, SHARED_KEY, { owner: "A" })
		const b = await run(USER_B, SHARED_KEY, { owner: "B" })

		expect(a.result).toEqual({ owner: "A" })
		expect(b.result).toEqual({ owner: "B" })
		expect(a.calls.count).toBe(1)
		expect(b.calls.count).toBe(1)
	})

	itDb("each user replays only their own stored response", async () => {
		await run(USER_A, SHARED_KEY, { owner: "A" })
		await run(USER_B, SHARED_KEY, { owner: "B" })

		const replayA = await run(USER_A, SHARED_KEY, { owner: "SHOULD NOT RUN" })
		const replayB = await run(USER_B, SHARED_KEY, { owner: "SHOULD NOT RUN" })

		expect(replayA.result).toEqual({ owner: "A" })
		expect(replayB.result).toEqual({ owner: "B" })
		// Replayed, not re-executed.
		expect(replayA.calls.count).toBe(0)
		expect(replayB.calls.count).toBe(0)
	})

	itDb("stores one row per (author, key) pair", async () => {
		await run(USER_A, SHARED_KEY, { owner: "A" })
		await run(USER_B, SHARED_KEY, { owner: "B" })

		const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, SHARED_KEY))
		expect(rows.map(r => r.authorId).sort()).toEqual([USER_A, USER_B])
	})
})

describe("replay window", () => {
	beforeEach(async () => {
		if (!dbReachable) return
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))
	})

	itDb("replays a stored response without re-running the handler", async () => {
		const first = await run(USER_A, "replay-key-001", { n: 1 })
		const second = await run(USER_A, "replay-key-001", { n: 2 })

		expect(first.result).toEqual({ n: 1 })
		expect(second.result).toEqual({ n: 1 })
		expect(second.calls.count).toBe(0)
	})

	itDb("stamps an expiry in the future", async () => {
		await run(USER_A, "expiry-key-001", { ok: true })

		const [row] = await db
			.select()
			.from(idempotencyKeys)
			.where(and(eq(idempotencyKeys.authorId, USER_A), eq(idempotencyKeys.key, "expiry-key-001")))

		expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now())
	})

	itDb("executes fresh after the stored key has expired", async () => {
		await run(USER_A, "stale-key-0001", { generation: 1 })

		// Age the row past its window.
		await db
			.update(idempotencyKeys)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(and(eq(idempotencyKeys.authorId, USER_A), eq(idempotencyKeys.key, "stale-key-0001")))

		const replay = await run(USER_A, "stale-key-0001", { generation: 2 })

		expect(replay.result).toEqual({ generation: 2 })
		expect(replay.calls.count).toBe(1)
	})

	itDb("bypasses entirely when no key is sent", async () => {
		const first = await run(USER_A, undefined, { n: 1 })
		const second = await run(USER_A, undefined, { n: 2 })

		expect(first.result).toEqual({ n: 1 })
		expect(second.result).toEqual({ n: 2 })
	})

	itDb("bypasses when there is no authenticated user", async () => {
		const { result, calls } = await run(null, "anon-key-00001", { n: 1 })

		expect(result).toEqual({ n: 1 })
		expect(calls.count).toBe(1)
	})

	itDb("scopes anonymous consent replay to the validated guest device", async () => {
		const key = "1abf51c5-203e-45ed-a9be-ae072d49c547"
		const input = { id: key, purpose: "registration" }
		const first = await run(
			null,
			key,
			{ attempt: 1 },
			{
				devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
				input,
				consentRoute: true,
			}
		)
		const replay = await run(
			null,
			key,
			{ attempt: 2 },
			{
				devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
				input,
				consentRoute: true,
			}
		)

		expect(first.result).toEqual({ attempt: 1 })
		expect(replay.result).toEqual({ attempt: 1 })
		expect(replay.calls.count).toBe(0)
	})

	itDb("requires an idempotency key on the composed consent POST", async () => {
		await expect(
			run(
				null,
				undefined,
				{ ok: true },
				{ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-", consentRoute: true }
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
	})

	itDb("rejects a consent idempotency key that differs from the client record UUID", async () => {
		await expect(
			run(
				null,
				"1abf51c5-203e-45ed-a9be-ae072d49c547",
				{ ok: true },
				{
					devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
					input: { id: "c9bf440f-03c2-44ff-8306-64cba84e2813" },
					consentRoute: true,
				}
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
	})

	itDb("prefers a verified fallback session over a caller-supplied guest identity", async () => {
		const key = "92b93c99-77d8-4adf-ae88-dcc34eed8883"
		mockGetSession.mockResolvedValue({ user: { id: USER_A } })
		await run(
			null,
			key,
			{ owner: "account" },
			{
				devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
				input: { id: key, purpose: "registration" },
				consentRoute: true,
			}
		)

		const accountRows = await db
			.select()
			.from(idempotencyKeys)
			.where(and(eq(idempotencyKeys.authorId, USER_A), eq(idempotencyKeys.key, key)))
		const guestRows = await db
			.select()
			.from(idempotencyKeys)
			.where(and(eq(idempotencyKeys.authorId, GUEST_AUTHOR), eq(idempotencyKeys.key, key)))
		expect(accountRows).toHaveLength(1)
		expect(guestRows).toHaveLength(0)
	})
})

describe("F3 profile idempotency policy", () => {
	itDb("requires a key matching the profile request UUID", async () => {
		await expect(
			run(USER_A, undefined, { ok: true }, { profileRoute: true, input: { id: SHARED_KEY } })
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		await expect(
			run(
				USER_A,
				"3f2504e0-4f89-4fd3-9a0c-0305e82c3301",
				{ ok: true },
				{ profileRoute: true, input: { id: "8bdc754e-3d04-4eab-b98c-523f378ac1e4" } }
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
	})

	itDb("blocks a deactivated account before replaying a stored profile response", async () => {
		const key = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"
		await run(USER_A, key, { status: "complete" }, { profileRoute: true, input: { id: key } })
		mockIsActive.mockResolvedValue(false)
		await expect(
			run(USER_A, key, { status: "complete" }, { profileRoute: true, input: { id: key } })
		).rejects.toMatchObject({ code: "UNAUTHORIZED" })
	})
})

describe("scheduled cleanup", () => {
	const cleanupService = new ExpiryCleanupService()

	itDb("removes expired rows and leaves live ones", async () => {
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))

		await run(USER_A, "live-key-00001", { ok: true })
		await run(USER_A, "dead-key-00001", { ok: true })
		await db
			.update(idempotencyKeys)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(and(eq(idempotencyKeys.authorId, USER_A), eq(idempotencyKeys.key, "dead-key-00001")))

		await cleanupService.sweepIdempotencyKeys()

		const remaining = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.authorId, USER_A))

		expect(remaining.map(r => r.key)).toEqual(["live-key-00001"])
	})

	itDb("leaves nothing expired behind", async () => {
		await cleanupService.sweepIdempotencyKeys()

		const stale = await db
			.select()
			.from(idempotencyKeys)
			.where(lt(idempotencyKeys.expiresAt, new Date()))
		expect(stale).toHaveLength(0)
	})
})

describe("concurrent duplicates are serialized", () => {
	itDb("runs the handler once when the same key arrives twice at once", async () => {
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))

		// The advisory lock is the only thing making this safe: without it both
		// transactions read "no row for this author" and both execute the write,
		// which is precisely the duplicate the header exists to prevent.
		const first = countingHandler({ attempt: "first" })
		const second = countingHandler({ attempt: "second" })

		// Mirror `run`: take the procedure the interceptor returns, then execute
		// it the way the oRPC adapter would.
		const settle = async (handler: never, authorId = USER_A) => {
			const observable = await interceptor.intercept(contextFor(authorId, SHARED_KEY), handler)
			const emitted = await new Promise<{ "~orpc": { handler: (o: unknown) => unknown } }>(
				resolve => observable.subscribe({ next: resolve as (v: unknown) => void })
			)
			return emitted["~orpc"].handler({ input: {}, context: {} })
		}

		const [a, b] = await Promise.all([settle(first.handler), settle(second.handler)])

		expect(first.calls.count + second.calls.count).toBe(1)
		// Both callers saw the same response, and only one row exists.
		expect(a).toEqual(b)

		const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))
		expect(rows).toHaveLength(1)
	})

	itDb("does not serialize two authors who picked the same key", async () => {
		// The lock is keyed on author *and* key. Keyed on the key alone, one
		// user's traffic would block an unrelated user's.
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_B))

		const [a, b] = await Promise.all([
			run(USER_A, SHARED_KEY, { who: "a" }),
			run(USER_B, SHARED_KEY, { who: "b" }),
		])

		expect(a.result).toEqual({ who: "a" })
		expect(b.result).toEqual({ who: "b" })
		expect(a.calls.count).toBe(1)
		expect(b.calls.count).toBe(1)
	})
})

describe("replay after a sweep", () => {
	itDb("executes fresh once the swept row is gone", async () => {
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_A))

		await run(USER_A, SHARED_KEY, { attempt: 1 })
		await db
			.update(idempotencyKeys)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(idempotencyKeys.authorId, USER_A))

		await new ExpiryCleanupService().sweepIdempotencyKeys()

		// Expiry alone already causes a fresh execution; this proves the same
		// holds once the row has actually been deleted, which is the state a
		// client retrying a day later actually meets.
		const replay = await run(USER_A, SHARED_KEY, { attempt: 2 })

		expect(replay.calls.count).toBe(1)
		expect(replay.result).toEqual({ attempt: 2 })
	})
})
