import { Reflector } from "@nestjs/core"
import { resolve } from "node:path"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { of } from "rxjs"

import { auditLog, idempotencyKeys, moduleConfiguration, users } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import type { db as DatabaseClient } from "@/common/database/database.client"
import type { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import type { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		readonly code: string
		constructor(code: string, options?: { message?: string }) {
			super(options?.message)
			this.code = code
		}
	},
}))

const USER_ID = "f2-atomic-user"
const FAILURE_KEY = "f2-atomic-failure-001"
const REPLAY_KEY = "f2-atomic-replay-0001"
const CONFIG_KEY = "session_inactivity_minutes"
const TRIGGER_NAME = "f2_fail_idempotency_insert"
const FUNCTION_NAME = "f2_fail_idempotency_insert_fn"
const DATABASE_NAME = `f2_atomicity_spec_${process.pid}`

let db: typeof DatabaseClient
let AuditServiceConstructor: typeof AuditService
let InterceptorConstructor: typeof IdempotencyInterceptor
let ServiceConstructor: typeof PisoCampAdminConfigService
let admin: pg.Client
let originalConfig: unknown
let originalConfigExists = false

function contextFor(key: string) {
	return {
		getHandler: () => contextFor,
		getClass: () => class AdminConfigMutation {},
		switchToHttp: () => ({
			getRequest: () => ({
				headers: { "idempotency-key": key },
				session: { user: { id: USER_ID } },
			}),
		}),
	} as never
}

function configProcedure(service: PisoCampAdminConfigService, value: number) {
	const calls = { count: 0 }
	const procedure = {
		"~orpc": {
			handler: async () => {
				calls.count += 1
				return service.update({ actorId: USER_ID, session_inactivity_minutes: value })
			},
		},
	}
	return { calls, handler: { handle: () => of(procedure) } as never }
}

async function execute(
	interceptor: IdempotencyInterceptor,
	service: PisoCampAdminConfigService,
	key: string,
	value: number
) {
	const { calls, handler } = configProcedure(service, value)
	const observable = await interceptor.intercept(contextFor(key), handler)
	const procedure = await new Promise<{ "~orpc": { handler: (options: unknown) => unknown } }>(
		resolve => observable.subscribe({ next: resolve as (value: unknown) => void })
	)
	return { calls, result: await procedure["~orpc"].handler({ input: {}, context: {} }) }
}

async function removeFailureTrigger() {
	await db.execute(sql.raw(`drop trigger if exists "${TRIGGER_NAME}" on "idempotency_keys"`))
	await db.execute(sql.raw(`drop function if exists "${FUNCTION_NAME}"()`))
}

function createInterceptor() {
	return new InterceptorConstructor({ isActive: async () => true } as never, new Reflector())
}

async function resetEvidence() {
	await removeFailureTrigger()
	await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_ID))
	await db.delete(auditLog).where(eq(auditLog.actorId, USER_ID))
	await db
		.insert(moduleConfiguration)
		.values({ key: CONFIG_KEY, value: 30, updatedBy: USER_ID })
		.onConflictDoUpdate({
			target: moduleConfiguration.key,
			set: { value: 30, updatedBy: USER_ID, updatedAt: new Date() },
		})
}

beforeAll(async () => {
	const sourceUrl = new URL(process.env.DATABASE_URL!)
	const adminUrl = new URL(sourceUrl)
	adminUrl.pathname = "/postgres"
	const testUrl = new URL(sourceUrl)
	testUrl.pathname = `/${DATABASE_NAME}`
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	await admin.connect()
	const existingDatabase = await admin.query("select 1 from pg_database where datname = $1", [
		DATABASE_NAME,
	])
	if (existingDatabase.rowCount) throw new Error(`Refusing to reuse ${DATABASE_NAME}`)
	await admin.query(`create database "${DATABASE_NAME}"`)

	const migrationPool = new pg.Pool({ connectionString: testUrl.toString() })
	await migrate(drizzle({ client: migrationPool }), {
		migrationsFolder: resolve(__dirname, "../../../../../../packages/db/src/migrations"),
	})
	await migrationPool.end()
	process.env.DATABASE_URL = testUrl.toString()
	;({ db } = await import("@/common/database/database.client"))
	;({ AuditService: AuditServiceConstructor } = await import("@/common/audit/audit.service"))
	;({ IdempotencyInterceptor: InterceptorConstructor } =
		await import("@/shared/interceptors/idempotency.interceptor"))
	;({ PisoCampAdminConfigService: ServiceConstructor } =
		await import("./pisocamp-admin-config.service"))

	const [existing] = await db
		.select({ value: moduleConfiguration.value })
		.from(moduleConfiguration)
		.where(eq(moduleConfiguration.key, CONFIG_KEY))
	originalConfigExists = Boolean(existing)
	originalConfig = existing?.value
	await db.insert(users).values({
		id: USER_ID,
		name: "F2 Atomicity User",
		email: "f2-atomicity@test.local",
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	})
})

beforeEach(async () => {
	await resetEvidence()
})

afterAll(async () => {
	await removeFailureTrigger()
	await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_ID))
	await db.delete(auditLog).where(eq(auditLog.actorId, USER_ID))
	if (originalConfigExists) {
		await db
			.update(moduleConfiguration)
			.set({ value: originalConfig, updatedBy: null, updatedAt: new Date() })
			.where(eq(moduleConfiguration.key, CONFIG_KEY))
	} else {
		await db.delete(moduleConfiguration).where(eq(moduleConfiguration.key, CONFIG_KEY))
	}
	await db.delete(users).where(eq(users.id, USER_ID))
	await db.$client.end()
	await admin.query(
		"select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
		[DATABASE_NAME]
	)
	await admin.query(`drop database if exists "${DATABASE_NAME}"`)
	await admin.end()
})

describe("Piso CAMP idempotent transaction boundary", () => {
	it("rolls back configuration and audit when idempotency persistence fails", async () => {
		await db.execute(
			sql.raw(`
			create function "${FUNCTION_NAME}"() returns trigger language plpgsql as $$
			begin
				if new.key = '${FAILURE_KEY}' then
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

		const service = new ServiceConstructor(new AuditServiceConstructor())
		await expect(execute(createInterceptor(), service, FAILURE_KEY, 60)).rejects.toThrow()

		const [config] = await db
			.select({ value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(eq(moduleConfiguration.key, CONFIG_KEY))
		const audits = await db.select().from(auditLog).where(eq(auditLog.actorId, USER_ID))
		expect(config?.value).toBe(30)
		expect(audits).toHaveLength(0)
	})

	it("replays a same-key retry without duplicating its success audit", async () => {
		const service = new ServiceConstructor(new AuditServiceConstructor())
		const interceptor = createInterceptor()
		const first = await execute(interceptor, service, REPLAY_KEY, 60)
		const replay = await execute(interceptor, service, REPLAY_KEY, 90)

		const audits = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, USER_ID), eq(auditLog.action, "module_configuration.update")))
		expect(first.result).toEqual({ session_inactivity_minutes: 60 })
		expect(replay.result).toEqual(first.result)
		expect(first.calls.count).toBe(1)
		expect(replay.calls.count).toBe(0)
		expect(audits).toHaveLength(1)
	})
})
