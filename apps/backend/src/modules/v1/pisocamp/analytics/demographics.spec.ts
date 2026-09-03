import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { auditLog, consentRecords, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { DemographicsService } from "./demographics.service"

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

const ADMIN_ID = "an10-admin"
const NOTICE_ID = "7d2b1a7e-9f4c-4a2e-9d54-0a3b7a2c9e31"
const NOTICE_VERSION = "an10-notice-1"
const REGION = "NCR"
const OTHER_REGION = "R4A"
const CITY = "MNL"
const OTHER_CITY = "CAV"

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

/** A 22-character device pseudonym, which is what the schema insists on. */
function device(index: number) {
	return `An10Device${String(index).padStart(12, "0")}`
}

/**
 * AN-10. Consent is the join, not a filter: a profile without a granted
 * `demographic_analytics` consent has no business appearing in any cut, and a
 * group too small to be reported keeps its label and loses its figures.
 */
describe("AN-10 demographic and cohort reports", () => {
	let service: DemographicsService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table analytics_session, piso_camp_device_account_link,
				piso_camp_profile, consent_record, privacy_notice, city,
				region, module_configuration, audit_log, sessions, accounts, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into privacy_notice (id, version, title, body, source_url, content_sha256, effective_at)
			values (${NOTICE_ID}, ${NOTICE_VERSION}, 'AN10 notice', 'Body copy for the AN-10 fixture.',
			        'https://www.bsp.gov.ph/privacy', repeat('c', 64), now())
		`)
		await db.execute(sql`
			insert into region (code, name, catalog_version)
			values (${REGION}, 'National Capital Region', 'an10'),
			       (${OTHER_REGION}, 'Calabarzon', 'an10')
		`)
		await db.execute(sql`
			insert into city (code, region_code, name, catalog_version)
			values (${CITY}, ${REGION}, 'Manila', 'an10'),
			       (${OTHER_CITY}, ${OTHER_REGION}, 'Cavite City', 'an10')
		`)
		await db.insert(users).values({
			id: ADMIN_ID,
			name: "AN-10 admin",
			email: "an10-admin@example.test",
			emailVerified: true,
			createdAt: new Date("2026-09-01T00:00:00.000Z"),
			updatedAt: new Date("2026-09-01T00:00:00.000Z"),
		})
		service = new DemographicsService(
			new PisoCampAdminConfigService(new AuditService()),
			new AuditService()
		)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function consent(
		accountId: string,
		purpose: "registration" | "demographic_analytics",
		status: "granted" | "withdrawn" = "granted",
		respondedAt = new Date("2026-09-01T00:00:00.000Z")
	) {
		const id = randomUUID()
		await db.insert(consentRecords).values({
			id,
			accountId,
			purpose,
			noticeId: NOTICE_ID,
			noticeVersion: NOTICE_VERSION,
			status,
			respondedAt,
		})
		return id
	}

	/** A registered person: account, profile, consent and a linked device. */
	async function person(options: {
		index: number
		gender?: "female" | "male" | "prefer_not_to_say"
		age?: number
		region?: string
		city?: string
		analyticsConsent?: "granted" | "withdrawn" | "none"
		days?: number[]
	}) {
		const accountId = `an10-user-${options.index}`
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values({
			id: accountId,
			name: `AN-10 person ${options.index}`,
			email: `an10-${options.index}@example.test`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		const registration = await consent(accountId, "registration")
		await db.execute(sql`
			insert into piso_camp_profile
				(account_id, gender, age, region_code, city_code, registration_consent_record_id)
			values (${accountId}, ${options.gender ?? "female"}, ${options.age ?? 30},
			        ${options.region ?? REGION}, ${options.city ?? CITY}, ${registration})
		`)
		if ((options.analyticsConsent ?? "granted") !== "none") {
			await consent(
				accountId,
				"demographic_analytics",
				options.analyticsConsent === "withdrawn" ? "withdrawn" : "granted"
			)
		}

		const pseudoId = device(options.index)
		await db.execute(sql`
			insert into piso_camp_device_account_link
				(device_pseudo_id, account_id, registration_consent_record_id)
			values (${pseudoId}, ${accountId}, ${await consent(accountId, "registration")})
		`)
		for (const day of options.days ?? []) {
			const started = new Date(Date.UTC(2026, 8, day, 2))
			await db.execute(sql`
				insert into analytics_session
					(subject_pseudo_id, started_at, ended_at, local_date, duration_seconds,
					 event_count, screen_view_count)
				values (${pseudoId}, ${started.toISOString()},
				        ${new Date(started.getTime() + 600_000).toISOString()},
				        ${`2026-09-${String(day).padStart(2, "0")}`}, 600, 5, 3)
			`)
		}
		return accountId
	}

	async function setSuppression(minimum: number) {
		await db.execute(sql`
			insert into module_configuration (key, value, updated_by)
			values ('suppression_minimum', ${String(minimum)}::jsonb, ${ADMIN_ID})
			on conflict (key) do update set value = excluded.value
		`)
	}

	describe("AC1 — the distributions and cuts", () => {
		it("breaks the consented population down by each dimension", async () => {
			// Two people per group, because the smallest group the configuration
			// will report is two: a percentage over one person describes them.
			await setSuppression(2)
			await person({ index: 1, gender: "female", age: 20, days: [2, 3] })
			await person({ index: 2, gender: "female", age: 20, days: [2] })
			await person({ index: 3, gender: "male", age: 30, days: [2] })
			await person({ index: 4, gender: "male", age: 30, days: [3] })
			await person({
				index: 5,
				gender: "male",
				age: 65,
				region: OTHER_REGION,
				city: OTHER_CITY,
				days: [4],
			})
			await person({
				index: 6,
				gender: "male",
				age: 65,
				region: OTHER_REGION,
				city: OTHER_CITY,
				days: [4],
			})

			const summary = await service.summary(RANGE)

			expect(summary.consentedUsers).toBe(6)
			const byGender = summary.distributions.find(cut => cut.dimension === "gender")!
			expect(byGender.buckets).toEqual([
				{ key: "female", label: "Female", suppressed: false, users: 2, percent: 33.33 },
				{ key: "male", label: "Male", suppressed: false, users: 4, percent: 66.67 },
			])

			const byAge = summary.distributions.find(cut => cut.dimension === "ageGroup")!
			// The configured buckets, not ages: 20 is 18-24, 30 is 25-34, 65 is 60+.
			expect(byAge.buckets.map(bucket => bucket.key)).toEqual(["18-24", "25-34", "60+"])
			expect(byAge.buckets.map(bucket => bucket.users)).toEqual([2, 2, 2])

			const byRegion = summary.distributions.find(cut => cut.dimension === "region")!
			expect(byRegion.buckets.map(bucket => bucket.key)).toEqual([REGION, OTHER_REGION])
			const byCity = summary.distributions.find(cut => cut.dimension === "city")!
			expect(byCity.buckets.map(bucket => bucket.key)).toEqual([OTHER_CITY, CITY])
		})

		it("cuts DAU and session duration by gender", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2, 3] })
			await person({ index: 2, gender: "female", days: [2, 3] })
			await person({ index: 3, gender: "male", days: [2] })
			await person({ index: 4, gender: "male", days: [2] })

			const summary = await service.summary(RANGE)

			expect(summary.dauByGender.unit).toBe("users")
			const female = summary.dauByGender.rows.find(row => row.key === "female")!
			expect(female.users).toBe(2)
			// Four active person-days over a thirty-day range.
			expect(female.value).toBeCloseTo(0.13, 2)

			expect(summary.sessionDurationByGender.unit).toBe("seconds")
			expect(
				summary.sessionDurationByGender.rows.find(row => row.key === "male")!.value
			).toBe(600)
		})

		it("cuts retention by every dimension and churn by place", async () => {
			await setSuppression(2)
			// First seen on the 2nd and back on the 10th: retained at day 7.
			await person({ index: 1, gender: "female", days: [2, 10] })
			await person({ index: 2, gender: "female", days: [2, 10] })
			// First seen on the 2nd and never back.
			await person({ index: 3, gender: "male", days: [2] })
			await person({ index: 4, gender: "male", days: [2] })

			const summary = await service.summary(RANGE)

			expect(summary.retention.map(cut => cut.dimension)).toEqual([
				"ageGroup",
				"gender",
				"region",
				"city",
			])
			const retentionByGender = summary.retention.find(cut => cut.dimension === "gender")!
			expect(retentionByGender.rows.find(row => row.key === "female")!.value).toBe(100)
			expect(retentionByGender.rows.find(row => row.key === "male")!.value).toBe(0)

			expect(summary.churn.map(cut => cut.dimension)).toEqual(["region", "city"])
			// Everybody was last seen inside the configured quiet period, so
			// nobody has churned yet.
			expect(summary.churn[0]!.rows[0]!.value).toBe(0)
		})
	})

	describe("AC2 — a group below the minimum is suppressed and marked", () => {
		it("withholds the figures and keeps the label", async () => {
			await setSuppression(3)
			await person({ index: 1, gender: "female", days: [2] })
			await person({ index: 2, gender: "female", days: [2] })
			await person({ index: 3, gender: "male", days: [2] })

			const summary = await service.summary(RANGE)

			const byGender = summary.distributions.find(cut => cut.dimension === "gender")!
			expect(byGender.suppressedBuckets).toBe(2)
			// The label stays: "fewer than three" is the finding, and dropping
			// the row would read as nobody at all.
			expect(byGender.buckets).toEqual([
				{ key: "female", label: "Female", suppressed: true, users: null, percent: null },
				{ key: "male", label: "Male", suppressed: true, users: null, percent: null },
			])
		})

		it("suppresses a measure the same way", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2] })
			await person({ index: 2, gender: "male", days: [2] })
			await person({ index: 3, gender: "male", days: [2] })

			const summary = await service.summary(RANGE)

			const female = summary.dauByGender.rows.find(row => row.key === "female")!
			expect(female).toMatchObject({ suppressed: true, users: null, value: null })
			const male = summary.dauByGender.rows.find(row => row.key === "male")!
			expect(male.suppressed).toBe(false)
		})

		it("uses the configured minimum rather than a hard-coded ten", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2] })
			await person({ index: 2, gender: "female", days: [2] })

			const summary = await service.summary(RANGE)

			expect(summary.suppressionMinimum).toBe(2)
			expect(
				summary.distributions.find(cut => cut.dimension === "gender")!.buckets[0]!.suppressed
			).toBe(false)
		})

		it("defaults the minimum to ten when nothing is configured", async () => {
			await person({ index: 1, days: [2] })

			const summary = await service.summary(RANGE)

			expect(summary.suppressionMinimum).toBe(10)
			expect(
				summary.distributions.find(cut => cut.dimension === "gender")!.buckets[0]!.suppressed
			).toBe(true)
		})
	})

	describe("AC3 — no consent, no demographic cut", () => {
		it("leaves out a profile that never granted the analytics consent", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2] })
			await person({ index: 2, gender: "male", analyticsConsent: "none", days: [2] })

			const summary = await service.summary(RANGE)

			expect(summary.consentedUsers).toBe(1)
			expect(summary.withoutConsentUsers).toBe(1)
			const byGender = summary.distributions.find(cut => cut.dimension === "gender")!
			expect(byGender.buckets.map(bucket => bucket.key)).toEqual(["female"])
		})

		it("leaves out somebody who has since withdrawn it", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2] })
			const withdrawn = await person({
				index: 2,
				gender: "male",
				analyticsConsent: "withdrawn",
				days: [2],
			})

			const summary = await service.summary(RANGE)

			expect(summary.consentedUsers).toBe(1)
			expect(
				summary.distributions
					.find(cut => cut.dimension === "gender")!
					.buckets.map(bucket => bucket.key)
			).toEqual(["female"])
			expect(withdrawn).toBe("an10-user-2")
		})

		it("honours the most recent answer when consent changed twice", async () => {
			await setSuppression(2)
			const accountId = await person({
				index: 1,
				gender: "female",
				analyticsConsent: "withdrawn",
				days: [2],
			})
			// Granted again, later: only the current answer is the lawful one.
			await consent(
				accountId,
				"demographic_analytics",
				"granted",
				new Date("2026-09-05T00:00:00.000Z")
			)

			const summary = await service.summary(RANGE)

			expect(summary.consentedUsers).toBe(1)
		})
	})

	describe("AC4 — the PII drill-down", () => {
		it("returns the rows behind a bucket and audits who read them", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2, 3] })
			await person({ index: 2, gender: "male", days: [2] })

			const result = await service.drilldown(
				{ ...RANGE, dimension: "gender", bucketKey: "female", limit: 50 },
				ADMIN_ID
			)

			expect(result.totalUsers).toBe(1)
			expect(result.rows).toHaveLength(1)
			expect(result.rows[0]).toMatchObject({
				accountId: "an10-user-1",
				email: "an10-1@example.test",
				gender: "female",
				activeDays: 2,
				lastActiveDate: "2026-09-03",
			})

			const audits = await db.select().from(auditLog)
			expect(audits).toHaveLength(1)
			// Reading who is in a group is a different act from reading how many
			// are, and only one of them has to be answerable for later.
			expect(audits[0]).toMatchObject({
				domain: "pisocamp",
				action: "demographics.pii_view",
				actorId: ADMIN_ID,
				targetType: "demographic_bucket",
				targetId: "gender:female",
			})
		})

		it("reaches nobody who withheld consent, even by drill-down", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", analyticsConsent: "none", days: [2] })

			const result = await service.drilldown(
				{ ...RANGE, dimension: "gender", bucketKey: "female", limit: 50 },
				ADMIN_ID
			)

			expect(result.rows).toEqual([])
			expect(result.totalUsers).toBe(0)
		})

		it("carries no row-level data in the summary itself", async () => {
			await setSuppression(2)
			await person({ index: 1, gender: "female", days: [2] })

			const summary = await service.summary(RANGE)

			// §4.2-J: a cut names groups, never people. The drill-down is its own
			// endpoint precisely so this can be asserted.
			expect(JSON.stringify(summary)).not.toContain("an10-1@example.test")
			expect(JSON.stringify(summary)).not.toContain("an10-user-1")
		})
	})
})
