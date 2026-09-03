import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import {
	analyticsEvents,
	auditLog,
	consentRecords,
	pisoCampAccountState,
	pisoCampCities,
	pisoCampProfiles,
	pisoCampRegions,
	privacyNotices,
	sessions,
	triviaResponses,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampDataSubjectService } from "./data-subject.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const ADMIN_ID = "sa7-admin"
const SUBJECT_ID = "sa7-subject"
const NOTICE_ID = "6b6f1f5a-6b3d-4d19-9a4e-1f2b3c4d5e6f"
const NOTICE_VERSION = "2026-09-01"
const SUBJECT_PSEUDO = "SaSevenSubjectPseudo01"
const CONSENT_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
const REGION_CODE = "1300000000"
const CITY_CODE = "1380100000"

/**
 * SA-7. A deletion is judged by what survives as much as by what goes, so every
 * case here checks both halves.
 */
describe("SA-7 data subject export and deletion", () => {
	let service: PisoCampDataSubjectService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table audit_log, analytics_event, trivia_response, piso_camp_profile,
			piso_camp_device_account_link, pisocamp_account_state, sessions, accounts, users
			restart identity cascade
		`)
		await db.execute(sql`truncate table consent_record restart identity cascade`)
		await db.execute(sql`truncate table privacy_notice restart identity cascade`)
		await db.execute(sql`truncate table city, region restart identity cascade`)

		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values([
			{
				id: ADMIN_ID,
				name: "Ada Admin",
				email: "ada@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: SUBJECT_ID,
				name: "Sam Subject",
				email: "sam@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		])
		await db.insert(privacyNotices).values({
			id: NOTICE_ID,
			version: NOTICE_VERSION,
			title: "BSP Mobile App Privacy Notice",
			body: "The notice body.",
			sourceUrl: "https://www.bsp.gov.ph/privacy",
			contentSha256: "b".repeat(64),
			effectiveAt: now,
		})
		await db.insert(pisoCampRegions).values({
			code: REGION_CODE,
			name: "NCR",
			catalogVersion: "PSGC-2Q-2026",
		})
		await db.insert(pisoCampCities).values({
			code: CITY_CODE,
			regionCode: REGION_CODE,
			name: "Manila",
			catalogVersion: "PSGC-2Q-2026",
		})
		await db.insert(consentRecords).values({
			id: CONSENT_ID,
			accountId: SUBJECT_ID,
			purpose: "registration",
			noticeId: NOTICE_ID,
			noticeVersion: NOTICE_VERSION,
			status: "granted",
			respondedAt: now,
		})
		await db.insert(pisoCampProfiles).values({
			accountId: SUBJECT_ID,
			gender: "female",
			age: 34,
			regionCode: REGION_CODE,
			cityCode: CITY_CODE,
			registrationConsentRecordId: CONSENT_ID,
		})
		await db.insert(triviaResponses).values({
			responseId: randomUUID(),
			accountId: SUBJECT_ID,
			contentItemId: randomUUID(),
			contentVersionId: randomUUID(),
			category: "banknotes",
			difficulty: "easy",
			correct: true,
			skipped: false,
			linkOpened: false,
			points: 10,
			answeredAt: now,
		})
		await db.insert(sessions).values({
			id: "sam-phone",
			token: "token-sam-phone",
			userId: SUBJECT_ID,
			expiresAt: new Date(Date.now() + 86_400_000),
		})
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: "module_entry",
			occurredAt: now,
			subjectPseudoId: SUBJECT_PSEUDO,
			sessionId: randomUUID(),
			accountType: "registered",
			screen: "pisocamp_home",
			feature: "module",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "online",
			status: "completed",
			properties: { entryPoint: "navigation" } as never,
		})

		service = new PisoCampDataSubjectService(new AuditService())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	describe("AC2 — the export is readable and documented", () => {
		it("carries the profile, consents and answers, each described", async () => {
			const exported = await service.exportFor(SUBJECT_ID)

			expect(exported.account).toMatchObject({
				id: SUBJECT_ID,
				email: "sam@example.test",
				status: "active",
			})
			expect(exported.profile).toMatchObject({ gender: "female", age: 34 })
			expect(exported.consents).toEqual([
				expect.objectContaining({ purpose: "registration", decision: "granted" }),
			])
			expect(exported.triviaResponses).toHaveLength(1)
			// Every section says what it is: an export nobody can read is not an
			// answer to "what do you have about me".
			expect(Object.values(exported.documentation).every(line => line.length > 0)).toBe(true)
		})

		it("says why analytics are not in it", async () => {
			const exported = await service.exportFor(SUBJECT_ID)

			// Not an omission: there is nothing in them tied to this person, and
			// silence would read as something withheld.
			expect(exported.documentation.analytics).toContain("device pseudonym")
		})

		it("refuses an account that does not exist", async () => {
			await expect(service.exportFor("nobody")).rejects.toMatchObject({ code: "NOT_FOUND" })
		})
	})

	describe("AC3 — deletion removes what identifies, keeps what must be kept", () => {
		async function deleteSubject() {
			return service.deleteFor({
				accountId: SUBJECT_ID,
				approvalReference: "DSR-2026-014",
				actorId: ADMIN_ID,
			})
		}

		it("counts what it did", async () => {
			const result = await deleteSubject()

			expect(result).toMatchObject({
				accountId: SUBJECT_ID,
				profileDeleted: true,
				sessionsEnded: 1,
				triviaResponsesDeleted: 1,
				consentRecordsRetained: 1,
			})
		})

		it("removes the profile and ends every session", async () => {
			await deleteSubject()

			expect(
				await db.select().from(pisoCampProfiles).where(eq(pisoCampProfiles.accountId, SUBJECT_ID))
			).toHaveLength(0)
			expect(await db.select().from(sessions)).toHaveLength(0)
		})

		it("keeps the account row, without what identified a person", async () => {
			await deleteSubject()

			const [account] = await db.select().from(users).where(eq(users.id, SUBJECT_ID))
			// The row stays so the audit trail keeps its actor: an entry that
			// cannot say who acted is not evidence.
			expect(account).toMatchObject({ name: "Deleted account", emailVerified: false })
			expect(account?.email).not.toBe("sam@example.test")
		})

		it("keeps the consent records, which are the proof collection was lawful", async () => {
			await deleteSubject()

			// Destroying them would destroy the defence, not the exposure.
			expect(
				await db.select().from(consentRecords).where(eq(consentRecords.accountId, SUBJECT_ID))
			).toHaveLength(1)
		})

		it("keeps the analytics, which never named this person", async () => {
			await deleteSubject()

			// The aggregates are keyed to a device pseudonym; deleting the link is
			// what makes them safe to keep.
			expect(await db.select().from(analyticsEvents)).toHaveLength(1)
		})

		it("leaves the account unable to sign in", async () => {
			await deleteSubject()

			await expect(new AccountAccessService().isActive(SUBJECT_ID)).resolves.toBe(false)
			const [state] = await db
				.select()
				.from(pisoCampAccountState)
				.where(eq(pisoCampAccountState.accountId, SUBJECT_ID))
			expect(state?.reason).toContain("DSR-2026-014")
		})

		it("audits the deletion with the approval it was done under", async () => {
			const result = await deleteSubject()

			const rows = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.action, "data_subject.delete"))
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				domain: "pisocamp",
				actorId: ADMIN_ID,
				targetType: "user",
				targetId: SUBJECT_ID,
				reason: "DSR-2026-014",
			})
			// What was there, and what was done about it.
			expect(rows[0]?.oldValue).toMatchObject({ email: "sam@example.test" })
			expect(rows[0]?.newValue).toMatchObject(result)
		})

		it("refuses an account that does not exist, and records nothing", async () => {
			await expect(
				service.deleteFor({
					accountId: "nobody",
					approvalReference: "DSR-2026-015",
					actorId: ADMIN_ID,
				})
			).rejects.toMatchObject({ code: "NOT_FOUND" })

			expect(await db.select().from(auditLog)).toHaveLength(0)
		})

		it("leaves an export of the deleted account carrying nothing personal", async () => {
			await deleteSubject()

			const exported = await service.exportFor(SUBJECT_ID)

			expect(exported.profile).toBeNull()
			expect(exported.triviaResponses).toEqual([])
			expect(exported.account.name).toBe("Deleted account")
		})
	})
})
