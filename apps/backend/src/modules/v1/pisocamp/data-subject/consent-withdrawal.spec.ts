import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { consentRecords, privacyNotices, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import {
	PisoCampConsentService,
	type ConsentSubject,
} from "../pisocamp-consent.service"

const SUBJECT_ID = "sa7-withdrawer"
const NOTICE_ID = "3a1b2c3d-4e5f-4061-8273-849506172839"
const NOTICE_VERSION = "2026-09-01"

/**
 * SA-7 AC1. Withdrawal is a decision in its own right, and the moment it is
 * recorded the guard that gates collection stops letting anything through.
 */
describe("SA-7 consent withdrawal", () => {
	let service: PisoCampConsentService
	const subject: ConsentSubject = { accountId: SUBJECT_ID }

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`truncate table consent_record restart identity cascade`)
		await db.execute(sql`
			truncate table privacy_notice, sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values({
			id: SUBJECT_ID,
			name: "Sam Subject",
			email: "sam@example.test",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		await db.insert(privacyNotices).values({
			id: NOTICE_ID,
			version: NOTICE_VERSION,
			title: "BSP Mobile App Privacy Notice",
			body: "The notice body.",
			sourceUrl: "https://www.bsp.gov.ph/privacy",
			contentSha256: "c".repeat(64),
			effectiveAt: now,
		})
		await db.execute(sql`
			insert into module_configuration (key, value)
			values ('active_privacy_notice_version', to_jsonb(${NOTICE_VERSION}::text))
			on conflict (key) do update set value = to_jsonb(${NOTICE_VERSION}::text)
		`)
		service = new PisoCampConsentService(db, db as never)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function record(decision: "granted" | "withdrawn") {
		return service.record(subject, {
			id: randomUUID(),
			purpose: "survey",
			noticeId: NOTICE_ID,
			noticeVersion: NOTICE_VERSION,
			decision,
			respondedAt: new Date().toISOString(),
		})
	}

	it("writes a withdrawn record rather than overwriting the grant", async () => {
		await record("granted")

		const withdrawn = await record("withdrawn")

		expect(withdrawn).toMatchObject({ decision: "withdrawn", state: "withdrawn" })
		// The trail is append-only: the grant that was true at the time is still
		// there, which is what proves collection was lawful while it happened.
		const rows = await db.select().from(consentRecords).orderBy(consentRecords.recordedAt)
		expect(rows.map(row => row.status)).toEqual(["granted", "withdrawn"])
	})

	it("stops consent-dependent collection immediately", async () => {
		await record("granted")
		await expect(service.getStatus(subject, "survey")).resolves.toMatchObject({
			state: "granted",
		})

		await record("withdrawn")

		// The guard admits only "granted", so the next request is refused with no
		// change to the guard at all.
		await expect(service.getStatus(subject, "survey")).resolves.toMatchObject({
			state: "withdrawn",
		})
	})

	it("reports a withdrawal as itself, not as a decline", async () => {
		await record("granted")

		const withdrawn = await record("withdrawn")

		// Declining is never having agreed; withdrawing is having agreed and
		// changed your mind, and only the second obliges anybody to stop.
		expect(withdrawn.decision).toBe("withdrawn")
	})

	it("lets somebody grant again after withdrawing", async () => {
		await record("granted")
		await record("withdrawn")

		await record("granted")

		await expect(service.getStatus(subject, "survey")).resolves.toMatchObject({
			state: "granted",
		})
	})
})
