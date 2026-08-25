import "dotenv/config"

import { ConflictException, ServiceUnavailableException } from "@nestjs/common"
import { createHash } from "node:crypto"
import path from "node:path"
import { eq } from "drizzle-orm"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import {
	consentRecords,
	moduleConfiguration,
	pisoCampDeviceAccountLinks,
	privacyNotices,
	schema,
	users,
} from "@repo/db/schema"

import { PisoCampConsentService } from "./pisocamp-consent.service"

const databaseName = `f4_consent_service_${process.pid}`
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const adminUrl = sourceUrl ? new URL(sourceUrl) : undefined
if (adminUrl) adminUrl.pathname = "/postgres"

let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let database: NodePgDatabase<typeof schema>
let service: PisoCampConsentService
let reachable = false

const noticeBody = "TEST FIXTURE ONLY — not approved legal copy."
const firstNotice = {
	id: "1cca6b9c-b217-5e59-b679-c9368763274d",
	version: "2024-12-26",
	title: "BSP Mobile App Privacy Notice",
	body: noticeBody,
	sourceUrl: "https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx",
	contentSha256: createHash("sha256").update(noticeBody).digest("hex"),
	effectiveAt: new Date("2024-12-26T00:00:00.000Z"),
}

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

beforeAll(async () => {
	if (!adminUrl || !sourceUrl) return
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	try {
		await admin.connect()
	} catch (error) {
		if (!isUnavailable(error)) throw error
		await admin.end().catch(() => undefined)
		admin = undefined
		return
	}
	const exists = await admin.query("select 1 from pg_database where datname = $1", [databaseName])
	if (exists.rowCount) throw new Error(`Refusing to reuse ${databaseName}`)
	await admin.query(`create database "${databaseName}"`)
	const databaseUrl = new URL(sourceUrl)
	databaseUrl.pathname = `/${databaseName}`
	pool = new pg.Pool({ connectionString: databaseUrl.toString() })
	database = drizzle({ client: pool, schema })
	await migrate(database, {
		migrationsFolder: path.resolve(process.cwd(), "../../packages/db/src/migrations"),
	})
	await database.insert(privacyNotices).values(firstNotice)
	await database.insert(users).values({
		id: "consent-account-1",
		name: "Consent Account",
		email: "consent-account-1@test.local",
	})
	service = new PisoCampConsentService(database, {
		transaction: work => database.transaction(work),
	})
	reachable = true
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

const itDb: jest.It = ((name: string, fn: jest.ProvidesCallback) =>
	it(name, async (...args: unknown[]) => {
		if (!reachable) {
			process.stderr.write(`[f4 consent service] skipped "${name}": PostgreSQL unavailable\n`)
			return
		}
		return (fn as (...values: unknown[]) => unknown)(...args)
	})) as jest.It

describe("PisoCampConsentService", () => {
	itDb("returns the active full notice and none for a fresh guest", async () => {
		await expect(
			service.getStatus({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" }, "registration")
		).resolves.toEqual({
			purpose: "registration",
			state: "none",
			notice: expect.objectContaining({
				id: firstNotice.id,
				version: firstNotice.version,
				body: noticeBody,
			}),
		})
	})

	itDb("records and returns immutable guest consent", async () => {
		const input = {
			id: "b3e8f099-a472-42c2-8e82-890446fe6411",
			purpose: "registration" as const,
			noticeId: firstNotice.id,
			noticeVersion: firstNotice.version,
			decision: "granted" as const,
			respondedAt: "2026-08-24T01:02:03.000Z",
		}
		const recorded = await service.record({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" }, input)
		expect(recorded).toEqual({
			...input,
			recordedAt: expect.any(String),
			state: "granted",
		})
		await expect(
			service.getStatus({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" }, "registration")
		).resolves.toMatchObject({ state: "granted" })
	})

	itDb("derives authenticated consent through a linked pre-signup device", async () => {
		await database
			.insert(pisoCampDeviceAccountLinks)
			.values({
				devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
				accountId: "consent-account-1",
				registrationConsentRecordId: "b3e8f099-a472-42c2-8e82-890446fe6411",
			})
			.onConflictDoNothing()
		await expect(
			service.getStatus({ accountId: "consent-account-1" }, "registration")
		).resolves.toMatchObject({ state: "granted" })
	})

	itDb(
		"inherits only the exact linked registration evidence, not later device or other-purpose records",
		async () => {
			await database.insert(consentRecords).values([
				{
					id: "33d99af9-4d05-4d49-9001-0bf97e105798",
					devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
					purpose: "registration",
					noticeId: firstNotice.id,
					noticeVersion: firstNotice.version,
					status: "declined",
					respondedAt: new Date("2026-08-24T05:00:00Z"),
					recordedAt: new Date("2026-08-24T05:00:00Z"),
				},
				{
					id: "633d8fd3-b86b-4136-a0a0-755ebf682165",
					devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
					purpose: "survey",
					noticeId: firstNotice.id,
					noticeVersion: firstNotice.version,
					status: "granted",
					respondedAt: new Date("2026-08-24T06:00:00Z"),
					recordedAt: new Date("2026-08-24T06:00:00Z"),
				},
			])
			await expect(
				service.getStatus({ accountId: "consent-account-1" }, "registration")
			).resolves.toMatchObject({ state: "granted" })
			await expect(
				service.getStatus({ accountId: "consent-account-1" }, "survey")
			).resolves.toMatchObject({ state: "none" })
		}
	)

	itDb("replays the same client UUID but conflicts on changed evidence", async () => {
		const input = {
			id: "86ea260d-78ca-49da-8d07-a7570ed75d6b",
			purpose: "survey" as const,
			noticeId: firstNotice.id,
			noticeVersion: firstNotice.version,
			decision: "granted" as const,
			respondedAt: "2026-08-24T02:02:03.000Z",
		}
		const first = await service.record({ accountId: "consent-account-1" }, input)
		await expect(service.record({ accountId: "consent-account-1" }, input)).resolves.toEqual(first)
		await expect(
			service.record({ accountId: "consent-account-1" }, { ...input, decision: "declined" })
		).rejects.toBeInstanceOf(ConflictException)
		const rows = await pool?.query("select id from consent_record where id = $1", [input.id])
		expect(rows?.rowCount).toBe(1)
	})

	itDb("fails closed when the configured approved body is absent", async () => {
		await database
			.update(moduleConfiguration)
			.set({ value: "missing-version" })
			.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))
		await expect(
			service.getStatus({ devicePseudoId: "ZbCdEfGhIjKlMnOpQrSt_-" }, "registration")
		).rejects.toBeInstanceOf(ServiceUnavailableException)
		await database
			.update(moduleConfiguration)
			.set({ value: firstNotice.version })
			.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))
	})

	itDb("derives reconsent after a version bump and rejects a stale queued decision", async () => {
		const secondNotice = {
			...firstNotice,
			id: "97aeeb73-92dc-4b60-83a8-6fc65aa2f434",
			version: "2026-08-24-test-fixture",
			title: "TEST FIXTURE ONLY — replacement notice",
			effectiveAt: new Date("2026-08-24T00:00:00.000Z"),
		}
		await database.insert(privacyNotices).values(secondNotice)
		await database
			.update(moduleConfiguration)
			.set({ value: secondNotice.version })
			.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))

		await expect(
			service.getStatus({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" }, "registration")
		).resolves.toMatchObject({ state: "requires_reconsent", notice: { id: secondNotice.id } })
		await expect(
			service.record(
				{ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" },
				{
					id: "5f4fb2d6-5fac-4bf0-8ccf-5b4c3bec8763",
					purpose: "registration",
					noticeId: firstNotice.id,
					noticeVersion: firstNotice.version,
					decision: "granted",
					respondedAt: "2026-08-24T03:02:03.000Z",
				}
			)
		).rejects.toBeInstanceOf(ConflictException)
		const stale = await database
			.select()
			.from(consentRecords)
			.where(eq(consentRecords.id, "5f4fb2d6-5fac-4bf0-8ccf-5b4c3bec8763"))
		expect(stale).toHaveLength(0)
	})
})
