import { Reflector } from "@nestjs/core"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { of } from "rxjs"

import {
	consentRecords,
	idempotencyKeys,
	pisoCampAccountState,
	privacyNotices,
	users,
} from "@repo/db/schema"

import type { databaseTransactionContext as TransactionContext } from "@/common/database/database-transaction.context"
import type { db as DatabaseClient } from "@/common/database/database.client"
import type { AccountAccessService } from "@/common/rbac/account-access.service"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import type { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import type { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import type { PisoCampConsentService } from "./pisocamp-consent.service"

jest.mock("better-auth/node", () => ({
	fromNodeHeaders: jest.fn((headers: unknown) => headers),
}))
jest.mock("@repo/auth", () => ({
	getAuth: jest.fn(() => ({
		api: { getSession: jest.fn().mockResolvedValue(null) },
	})),
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

const DATABASE_NAME = `f4_consent_atomicity_${process.pid}`
const DEVICE_ID = "AbCdEfGhIjKlMnOpQrSt_-"
const GUEST_AUTHOR = `guest:${DEVICE_ID}`
const RECORD_ID = "4c236423-3861-4ad0-a3d1-57e28950c59e"
const FAILURE_RECORD_ID = "d3571dbb-58bf-426a-8976-ad58ac4c0a87"
const DEACTIVATED_RECORD_ID = "fc067836-d2a7-4480-9ef3-e9c70144e331"
const ACCOUNT_ID = "f4-consent-replay-account"
const TRIGGER_NAME = "f4_fail_idempotency_insert"
const FUNCTION_NAME = "f4_fail_idempotency_insert_fn"

let db: typeof DatabaseClient
let transactionContext: typeof TransactionContext
let AccountAccessServiceConstructor: typeof AccountAccessService
let InterceptorConstructor: typeof IdempotencyInterceptor
let IdempotencyServiceConstructor: typeof IdempotencyService
let ServiceConstructor: typeof PisoCampConsentService
let admin: pg.Client

const body = "TEST FIXTURE ONLY — not approved legal copy."
const notice = {
	id: "1cca6b9c-b217-5e59-b679-c9368763274d",
	version: "2024-12-26",
	title: "BSP Mobile App Privacy Notice",
	body,
	sourceUrl: "https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx",
	contentSha256: createHash("sha256").update(body).digest("hex"),
	effectiveAt: new Date("2024-12-26T00:00:00.000Z"),
}

class ConsentMutation {
	@RequireIdempotency({ requestIdField: "id", requireActiveAccount: true })
	execute() {}
}

function contextFor(key: string, accountId?: string) {
	return {
		getHandler: () => ConsentMutation.prototype.execute,
		getClass: () => ConsentMutation,
		switchToHttp: () => ({
			getRequest: () => ({
				headers: {
					"idempotency-key": key,
					"x-device-pseudo-id": DEVICE_ID,
				},
				session: accountId ? { user: { id: accountId } } : undefined,
			}),
		}),
	} as never
}

function consentProcedure(
	service: PisoCampConsentService,
	id: string,
	subject: { accountId: string } | { devicePseudoId: string } = { devicePseudoId: DEVICE_ID }
) {
	const calls = { count: 0 }
	const input = {
		id,
		purpose: "registration" as const,
		noticeId: notice.id,
		noticeVersion: notice.version,
		decision: "granted" as const,
		respondedAt: "2026-08-24T04:02:03.000Z",
	}
	const procedure = {
		"~orpc": {
			route: { method: "POST", path: "/v1/pisocamp/consent" },
			handler: async ({ input: requestInput }: { input: typeof input }) => {
				calls.count += 1
				return service.record(subject, requestInput)
			},
		},
	}
	return { calls, input, handler: { handle: () => of(procedure) } as never }
}

async function execute(
	interceptor: IdempotencyInterceptor,
	service: PisoCampConsentService,
	id: string,
	subject: { accountId: string } | { devicePseudoId: string } = { devicePseudoId: DEVICE_ID }
) {
	const { calls, input, handler } = consentProcedure(service, id, subject)
	const accountId = "accountId" in subject ? subject.accountId : undefined
	const observable = await interceptor.intercept(contextFor(id, accountId), handler)
	const procedure = await new Promise<{ "~orpc": { handler: (options: unknown) => unknown } }>(
		resolveProcedure => observable.subscribe({ next: resolveProcedure as (value: unknown) => void })
	)
	return {
		calls,
		result: await procedure["~orpc"].handler({ input, context: {} }),
	}
}

async function removeFailureTrigger() {
	await db.execute(sql.raw(`drop trigger if exists "${TRIGGER_NAME}" on "idempotency_keys"`))
	await db.execute(sql.raw(`drop function if exists "${FUNCTION_NAME}"()`))
}

function createInterceptor() {
	return new InterceptorConstructor(
		new AccountAccessServiceConstructor(),
		new Reflector(),
		new IdempotencyServiceConstructor()
	)
}

beforeAll(async () => {
	const sourceUrl = new URL(process.env.DATABASE_URL!)
	const adminUrl = new URL(sourceUrl)
	adminUrl.pathname = "/postgres"
	const testUrl = new URL(sourceUrl)
	testUrl.pathname = `/${DATABASE_NAME}`
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	await admin.connect()
	const existing = await admin.query("select 1 from pg_database where datname = $1", [
		DATABASE_NAME,
	])
	if (existing.rowCount) throw new Error(`Refusing to reuse ${DATABASE_NAME}`)
	await admin.query(`create database "${DATABASE_NAME}"`)

	const migrationPool = new pg.Pool({ connectionString: testUrl.toString() })
	await migrate(drizzle({ client: migrationPool }), {
		migrationsFolder: resolve(__dirname, "../../../../../../packages/db/src/migrations"),
	})
	await migrationPool.end()
	process.env.DATABASE_URL = testUrl.toString()
	;({ db } = await import("@/common/database/database.client"))
	;({ databaseTransactionContext: transactionContext } =
		await import("@/common/database/database-transaction.context"))
	;({ AccountAccessService: AccountAccessServiceConstructor } =
		await import("@/common/rbac/account-access.service"))
	;({ IdempotencyInterceptor: InterceptorConstructor } =
		await import("@/shared/interceptors/idempotency.interceptor"))
	;({ IdempotencyService: IdempotencyServiceConstructor } =
		await import("@/shared/interceptors/idempotency.service"))
	;({ PisoCampConsentService: ServiceConstructor } = await import("./pisocamp-consent.service"))
	await db.insert(privacyNotices).values(notice)
	await db.insert(users).values({
		id: ACCOUNT_ID,
		name: "F4 Consent Replay Account",
		email: "f4-consent-replay@test.local",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	})
})

afterAll(async () => {
	await removeFailureTrigger()
	await db.$client.end()
	await admin.query(
		"select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
		[DATABASE_NAME]
	)
	await admin.query(`drop database if exists "${DATABASE_NAME}"`)
	await admin.end()
})

describe("Piso CAMP consent idempotent transaction boundary", () => {
	it("rolls back consent evidence when replay persistence fails", async () => {
		await db.execute(
			sql.raw(`
				create function "${FUNCTION_NAME}"() returns trigger language plpgsql as $$
				begin
					if new.key = '${FAILURE_RECORD_ID}' then
						raise exception 'forced idempotency persistence failure';
					end if;
					return new;
				end
				$$
			`)
		)
		await db.execute(
			sql.raw(`
				create trigger "${TRIGGER_NAME}"
				before insert or update on "idempotency_keys"
				for each row execute function "${FUNCTION_NAME}"()
			`)
		)

		const service = new ServiceConstructor(db, transactionContext)
		await expect(execute(createInterceptor(), service, FAILURE_RECORD_ID)).rejects.toThrow()
		const rows = await db
			.select()
			.from(consentRecords)
			.where(eq(consentRecords.id, FAILURE_RECORD_ID))
		expect(rows).toHaveLength(0)
	})

	it("replays a successful same-key retry without duplicating consent evidence", async () => {
		await removeFailureTrigger()
		const service = new ServiceConstructor(db, transactionContext)
		const interceptor = createInterceptor()
		const first = await execute(interceptor, service, RECORD_ID)
		const replay = await execute(interceptor, service, RECORD_ID)

		expect(replay.result).toEqual(first.result)
		expect(first.calls.count).toBe(1)
		expect(replay.calls.count).toBe(0)
		const evidence = await db.select().from(consentRecords).where(eq(consentRecords.id, RECORD_ID))
		const keys = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.authorId, GUEST_AUTHOR))
		expect(evidence).toHaveLength(1)
		expect(keys).toHaveLength(1)
	})

	it("rejects a deactivated account before replaying a stored consent response", async () => {
		const service = new ServiceConstructor(db, transactionContext)
		const interceptor = createInterceptor()
		const subject = { accountId: ACCOUNT_ID }
		await execute(interceptor, service, DEACTIVATED_RECORD_ID, subject)
		await db.insert(pisoCampAccountState).values({
			accountId: ACCOUNT_ID,
			status: "deactivated",
			reason: "review regression fixture",
		})

		await expect(
			execute(interceptor, service, DEACTIVATED_RECORD_ID, subject)
		).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		const evidence = await db
			.select()
			.from(consentRecords)
			.where(eq(consentRecords.id, DEACTIVATED_RECORD_ID))
		expect(evidence).toHaveLength(1)
	})
})
