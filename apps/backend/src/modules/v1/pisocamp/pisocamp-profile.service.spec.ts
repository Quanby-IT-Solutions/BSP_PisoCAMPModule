import "dotenv/config"

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

import {
	consentRecords,
	moduleConfiguration,
	pisoCampAccountState,
	pisoCampDeviceAccountLinks,
	pisoCampProfiles,
	privacyNotices,
	schema,
	users,
} from "@repo/db/schema"

import { PisoCampProfileService } from "./pisocamp-profile.service"

const databaseName = `f3_profile_service_${process.pid}`
const sourceUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined
const adminUrl = sourceUrl ? new URL(sourceUrl) : undefined
if (adminUrl) adminUrl.pathname = "/postgres"
let admin: pg.Client | undefined
let pool: pg.Pool | undefined
let db: ReturnType<typeof drizzle<typeof schema>>
let service: PisoCampProfileService
const noticeId = "1cca6b9c-b217-5e59-b679-c9368763274d"
const accountId = "f3-account"
const deviceId = "AbCdEfGhIjKlMnOpQrSt_-"

beforeAll(async () => {
	if (!adminUrl || !sourceUrl) return
	admin = new pg.Client({ connectionString: adminUrl.toString() })
	try {
		await admin.connect()
	} catch {
		admin = undefined
		return
	}
	await admin.query(`create database "${databaseName}"`)
	const url = new URL(sourceUrl)
	url.pathname = `/${databaseName}`
	pool = new pg.Pool({ connectionString: url.toString() })
	db = drizzle({ client: pool, schema })
	await migrate(db, { migrationsFolder: "../../packages/db/src/migrations" })
	const now = new Date()
	await db.insert(users).values({
		id: accountId,
		name: "Profile User",
		email: "profile@test.local",
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	})
	await db.insert(privacyNotices).values({
		id: noticeId,
		version: "2024-12-26",
		title: "TEST",
		body: "TEST FIXTURE ONLY",
		sourceUrl: "https://example.test",
		contentSha256: "a".repeat(64),
		effectiveAt: now,
	})
	await db
		.insert(moduleConfiguration)
		.values({ key: "active_privacy_notice_version", value: "2024-12-26" })
		.onConflictDoUpdate({ target: moduleConfiguration.key, set: { value: "2024-12-26" } })
	await db.insert(consentRecords).values({
		id: "3f2504e0-4f89-4fd3-9a0c-0305e82c3301",
		devicePseudoId: deviceId,
		purpose: "registration",
		noticeId,
		noticeVersion: "2024-12-26",
		status: "granted",
		respondedAt: now,
	})
	service = new PisoCampProfileService(db as never, { transaction: work => db.transaction(work) })
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

describe("PisoCampProfileService", () => {
	it("returns recoverable missing status with Better Auth identity", async () => {
		if (!service) return
		await expect(service.getProfile(accountId)).resolves.toMatchObject({
			status: "missing",
			name: "Profile User",
			email: "profile@test.local",
			profile: null,
		})
	})

	it("rejects profile status for a deactivated authenticated account", async () => {
		if (!service) return
		const id = "f3-deactivated",
			now = new Date()
		await db.insert(users).values({
			id,
			name: "Deactivated",
			email: "deactivated@test.local",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		await db
			.insert(pisoCampAccountState)
			.values({ accountId: id, status: "deactivated", reason: "fixture" })
		await expect(service.getProfile(id)).rejects.toMatchObject({ status: 401 })
	})

	it("atomically creates profile, guest link, exact consent reference, and registered role", async () => {
		if (!service) return
		const output = await service.completeProfile(accountId, deviceId, {
			id: "8bdc754e-3d04-4eab-b98c-523f378ac1e4",
			gender: "prefer_not_to_say",
			age: 18,
			regionCode: "1300000000",
			cityCode: "1380600000",
		})
		expect(output).toMatchObject({
			status: "complete",
			name: "Profile User",
			profile: { registrationConsentRecordId: "3f2504e0-4f89-4fd3-9a0c-0305e82c3301" },
		})
		expect(await db.select().from(pisoCampProfiles)).toHaveLength(1)
		expect(await db.select().from(pisoCampDeviceAccountLinks)).toHaveLength(1)
		const membership = await pool!.query(
			"select 1 from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1 and r.name='Registered End User'",
			[accountId]
		)
		expect(membership.rowCount).toBe(1)
	})

	it("rejects a city that does not belong to the submitted region", async () => {
		if (!service) return
		await expect(
			service.completeProfile(accountId, deviceId, {
				id: crypto.randomUUID(),
				gender: "female",
				age: 25,
				regionCode: "0100000000",
				cityCode: "1380600000",
			})
		).rejects.toMatchObject({ status: 400 })
	})

	it("accepts current account-scoped consent for an existing incomplete account", async () => {
		if (!service) return
		const id = "f3-existing-account",
			device = "ZbCdEfGhIjKlMnOpQrSt_-",
			now = new Date()
		await db.insert(users).values({
			id,
			name: "Existing",
			email: "existing@test.local",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		await db.insert(consentRecords).values({
			id: "5f4fb2d6-5fac-4bf0-8ccf-5b4c3bec8763",
			accountId: id,
			purpose: "registration",
			noticeId,
			noticeVersion: "2024-12-26",
			status: "granted",
			respondedAt: now,
		})
		await expect(
			service.completeProfile(id, device, {
				id: crypto.randomUUID(),
				gender: "male",
				age: 40,
				regionCode: "0100000000",
				cityCode: "0102805000",
			})
		).resolves.toMatchObject({ status: "complete" })
	})

	it("rejects consent for another device and a device already linked elsewhere", async () => {
		if (!service) return
		const id = "f3-spoof-account",
			now = new Date()
		await db.insert(users).values({
			id,
			name: "Spoof",
			email: "spoof@test.local",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		await expect(
			service.completeProfile(id, "YbCdEfGhIjKlMnOpQrSt_-", {
				id: crypto.randomUUID(),
				gender: "female",
				age: 22,
				regionCode: "1300000000",
				cityCode: "1380600000",
			})
		).rejects.toMatchObject({ status: 412 })
		await db.insert(consentRecords).values({
			id: "97aeeb73-92dc-4b60-83a8-6fc65aa2f434",
			accountId: id,
			purpose: "registration",
			noticeId,
			noticeVersion: "2024-12-26",
			status: "granted",
			respondedAt: now,
		})
		await expect(
			service.completeProfile(id, deviceId, {
				id: crypto.randomUUID(),
				gender: "female",
				age: 22,
				regionCode: "1300000000",
				cityCode: "1380600000",
			})
		).rejects.toMatchObject({ status: 409 })
	})

	it("rejects when the latest current registration decision supersedes an older grant", async () => {
		if (!service) return
		const id = "f3-declined-account",
			device = "XbCdEfGhIjKlMnOpQrSt_-",
			now = new Date()
		await db.insert(users).values({
			id,
			name: "Declined",
			email: "declined@test.local",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		await db.insert(consentRecords).values([
			{
				id: "33d99af9-4d05-4d49-9001-0bf97e105798",
				devicePseudoId: device,
				purpose: "registration",
				noticeId,
				noticeVersion: "2024-12-26",
				status: "granted",
				respondedAt: new Date("2026-08-24T01:00:00Z"),
				recordedAt: new Date("2026-08-24T01:00:00Z"),
			},
			{
				id: "633d8fd3-b86b-4136-a0a0-755ebf682165",
				devicePseudoId: device,
				purpose: "registration",
				noticeId,
				noticeVersion: "2024-12-26",
				status: "declined",
				respondedAt: new Date("2026-08-24T02:00:00Z"),
				recordedAt: new Date("2026-08-24T02:00:00Z"),
			},
		])
		await expect(
			service.completeProfile(id, device, {
				id: crypto.randomUUID(),
				gender: "female",
				age: 30,
				regionCode: "1300000000",
				cityCode: "1380600000",
			})
		).rejects.toMatchObject({ status: 412 })
	})

	it("gives authenticated account consent precedence over the device header", async () => {
		if (!service) return
		const id = "f3-precedence-account",
			device = "WbCdEfGhIjKlMnOpQrSt_-",
			now = new Date()
		await db.insert(users).values({
			id,
			name: "Precedence",
			email: "precedence@test.local",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		await db.insert(consentRecords).values([
			{
				id: "a1f36ffb-49ea-46b2-8c0f-17db97021404",
				accountId: id,
				purpose: "registration",
				noticeId,
				noticeVersion: "2024-12-26",
				status: "granted",
				respondedAt: new Date("2026-08-24T01:00:00Z"),
				recordedAt: new Date("2026-08-24T01:00:00Z"),
			},
			{
				id: "71d0a526-c27c-43a7-ab48-2506bcc428a4",
				devicePseudoId: device,
				purpose: "registration",
				noticeId,
				noticeVersion: "2024-12-26",
				status: "declined",
				respondedAt: new Date("2026-08-24T02:00:00Z"),
				recordedAt: new Date("2026-08-24T02:00:00Z"),
			},
		])
		await expect(
			service.completeProfile(id, device, {
				id: crypto.randomUUID(),
				gender: "male",
				age: 31,
				regionCode: "1300000000",
				cityCode: "1380600000",
			})
		).resolves.toMatchObject({
			status: "complete",
			profile: { registrationConsentRecordId: "a1f36ffb-49ea-46b2-8c0f-17db97021404" },
		})
	})
})
