import { Reflector } from "@nestjs/core"
import { resolve } from "node:path"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { of } from "rxjs"

import {
	consentRecords,
	idempotencyKeys,
	moduleConfiguration,
	pisoCampAccountState,
	pisoCampDeviceAccountLinks,
	pisoCampProfiles,
	privacyNotices,
	roles,
	userRoles,
	users,
} from "@repo/db/schema"

import type { databaseTransactionContext as TransactionContext } from "@/common/database/database-transaction.context"
import type { db as DatabaseClient } from "@/common/database/database.client"
import type { AccountAccessService } from "@/common/rbac/account-access.service"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import type { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import type { PisoCampProfileService } from "./pisocamp-profile.service"

jest.mock("better-auth/node", () => ({ fromNodeHeaders: jest.fn((headers: unknown) => headers) }))
jest.mock("@repo/auth", () => ({
	getAuth: jest.fn(() => ({ api: { getSession: jest.fn().mockResolvedValue(null) } })),
}))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message)
		}
	},
}))

const databaseName = `f3_profile_atomicity_${process.pid}`
const accountId = "f3-atomic-account"
const deviceId = "AbCdEfGhIjKlMnOpQrSt_-"
const consentId = "3f2504e0-4f89-4fd3-9a0c-0305e82c3301"
const requestId = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"
const triggerName = "f3_fail_idempotency_insert"
const functionName = "f3_fail_idempotency_insert_fn"
let db: typeof DatabaseClient
let transactionContext: typeof TransactionContext
let Interceptor: typeof IdempotencyInterceptor
let AccountAccess: typeof AccountAccessService
let ProfileService: typeof PisoCampProfileService
let admin: pg.Client

class ProfileMutation {
	@RequireIdempotency({ requestIdField: "id", requireActiveAccount: true })
	execute() {}
}

function context() {
	return {
		getHandler: () => ProfileMutation.prototype.execute,
		getClass: () => ProfileMutation,
		switchToHttp: () => ({
			getRequest: () => ({
				headers: { "idempotency-key": requestId, "x-device-pseudo-id": deviceId },
				session: { user: { id: accountId } },
			}),
		}),
	} as never
}
function procedure(service: PisoCampProfileService) {
	const calls = { count: 0 }
	const input = {
		id: requestId,
		gender: "prefer_not_to_say" as const,
		age: 30,
		regionCode: "1300000000",
		cityCode: "1380600000",
	}
	const value = {
		"~orpc": {
			route: { method: "POST", path: "/v1/pisocamp/profile" },
			handler: async ({ input: body }: { input: typeof input }) => {
				calls.count++
				return service.completeProfile(accountId, deviceId, body)
			},
		},
	}
	return { calls, input, handler: { handle: () => of(value) } as never }
}
async function execute(interceptor: IdempotencyInterceptor, service: PisoCampProfileService) {
	const built = procedure(service)
	const observable = await interceptor.intercept(context(), built.handler)
	const proc = await new Promise<{ "~orpc": { handler: (options: unknown) => unknown } }>(done =>
		observable.subscribe({ next: done as never })
	)
	return {
		calls: built.calls,
		result: await proc["~orpc"].handler({ input: built.input, context: {} }),
	}
}
async function removeTrigger() {
	await db.execute(sql.raw(`drop trigger if exists "${triggerName}" on "idempotency_keys"`))
	await db.execute(sql.raw(`drop function if exists "${functionName}"()`))
}

beforeAll(async () => {
	const source = new URL(process.env.DATABASE_URL!),
		adminUrl = new URL(source),
		testUrl = new URL(source)
	adminUrl.pathname = "/postgres"
	testUrl.pathname = `/${databaseName}`
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	await admin.connect()
	await admin.query(`create database "${databaseName}"`)
	const pool = new pg.Pool({ connectionString: testUrl.toString() })
	await migrate(drizzle({ client: pool }), {
		migrationsFolder: resolve(__dirname, "../../../../../../packages/db/src/migrations"),
	})
	await pool.end()
	process.env.DATABASE_URL = testUrl.toString()
	;({ db } = await import("@/common/database/database.client"))
	;({ databaseTransactionContext: transactionContext } =
		await import("@/common/database/database-transaction.context"))
	;({ AccountAccessService: AccountAccess } = await import("@/common/rbac/account-access.service"))
	;({ IdempotencyInterceptor: Interceptor } =
		await import("@/shared/interceptors/idempotency.interceptor"))
	;({ PisoCampProfileService: ProfileService } = await import("./pisocamp-profile.service"))
	const now = new Date()
	await db.insert(users).values({
		id: accountId,
		name: "Atomic User",
		email: "atomic@test.local",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	})
	await db.insert(privacyNotices).values({
		id: "1cca6b9c-b217-5e59-b679-c9368763274d",
		version: "2024-12-26",
		title: "TEST",
		body: "TEST FIXTURE ONLY",
		sourceUrl: "https://example.test",
		contentSha256: "a".repeat(64),
		effectiveAt: now,
	})
	await db
		.update(moduleConfiguration)
		.set({ value: "2024-12-26" })
		.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))
	await db.insert(consentRecords).values({
		id: consentId,
		devicePseudoId: deviceId,
		purpose: "registration",
		noticeId: "1cca6b9c-b217-5e59-b679-c9368763274d",
		noticeVersion: "2024-12-26",
		status: "granted",
		respondedAt: now,
	})
})
afterAll(async () => {
	await removeTrigger()
	await db.$client.end()
	await admin.query(
		"select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
		[databaseName]
	)
	await admin.query(`drop database if exists "${databaseName}"`)
	await admin.end()
})

describe("F3 profile shared idempotency transaction", () => {
	it("rolls profile, device link, and role membership back when idempotency persistence fails", async () => {
		await db.execute(
			sql.raw(
				`create function "${functionName}"() returns trigger language plpgsql as $$ begin if new.key='${requestId}' then raise exception 'forced'; end if; return new; end $$`
			)
		)
		await db.execute(
			sql.raw(
				`create trigger "${triggerName}" before insert or update on "idempotency_keys" for each row execute function "${functionName}"()`
			)
		)
		const service = new ProfileService(db, transactionContext)
		await expect(
			execute(new Interceptor(new AccountAccess(), new Reflector()), service)
		).rejects.toThrow()
		expect(await db.select().from(pisoCampProfiles)).toHaveLength(0)
		expect(await db.select().from(pisoCampDeviceAccountLinks)).toHaveLength(0)
		expect(
			await db
				.select()
				.from(userRoles)
				.innerJoin(roles, eq(userRoles.roleId, roles.id))
				.where(and(eq(userRoles.userId, accountId), eq(roles.name, "Registered End User")))
		).toHaveLength(0)
	})

	it("retries once, persists once, and blocks deactivated replay", async () => {
		await removeTrigger()
		const service = new ProfileService(db, transactionContext),
			interceptor = new Interceptor(new AccountAccess(), new Reflector())
		const first = await execute(interceptor, service),
			replay = await execute(interceptor, service)
		expect(replay.result).toEqual(first.result)
		expect(first.calls.count).toBe(1)
		expect(replay.calls.count).toBe(0)
		expect(await db.select().from(pisoCampProfiles)).toHaveLength(1)
		expect(await db.select().from(pisoCampDeviceAccountLinks)).toHaveLength(1)
		expect(
			await db
				.select()
				.from(userRoles)
				.innerJoin(roles, eq(userRoles.roleId, roles.id))
				.where(and(eq(userRoles.userId, accountId), eq(roles.name, "Registered End User")))
		).toHaveLength(1)
		expect(
			await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.authorId, accountId))
		).toHaveLength(1)
		await db
			.insert(pisoCampAccountState)
			.values({ accountId, status: "deactivated", reason: "fixture" })
		await expect(execute(interceptor, service)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
	})
})
