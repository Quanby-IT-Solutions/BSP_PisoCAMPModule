import { eq, sql } from "drizzle-orm"

import { auditLog, moduleConfiguration, privacyNotices } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"

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

const ADMIN_ID = "sa3-admin"
const NOTICE_VERSION = "2026-09-01"

type AdminConfig = Awaited<ReturnType<PisoCampAdminConfigService["get"]>>

/**
 * SA-3. Every key is edited through one registry, so these tests are about the
 * registry's behaviour — defaulting, validating, persisting and auditing — for
 * the kinds of value it now has to carry, not about each key one at a time.
 */
describe("SA-3 module configuration registry", () => {
	let service: PisoCampAdminConfigService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table audit_log, module_configuration, consent_record, privacy_notice,
			sessions, accounts, users restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ADMIN_ID}, 'SA3 Admin', 'sa3-admin@example.test', true, now(), now())
		`)
		await db.insert(privacyNotices).values({
			id: "3f2a1c7e-9c1d-4a5b-8e2f-0d4b6a8c1e93",
			version: NOTICE_VERSION,
			title: "BSP Mobile App Privacy Notice",
			body: "The notice body.",
			sourceUrl: "https://www.bsp.gov.ph/privacy",
			contentSha256: "a".repeat(64),
			effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
		})
		service = new PisoCampAdminConfigService(new AuditService())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function save(overrides: Partial<AdminConfig> = {}) {
		const current = await service.get()
		return service.update({ ...current, ...overrides, actorId: ADMIN_ID })
	}

	describe("AC1 — every key validates, saves and is audited with before and after", () => {
		it("serves the declared default for a key nobody has set", async () => {
			const config = await service.get()

			expect(config).toMatchObject({
				session_inactivity_minutes: 30,
				trivia_repeat_days: 30,
				leaderboard_enabled: false,
				suppression_minimum: 10,
				recognition_confidence_threshold: 0.8,
				active_privacy_notice_version: null,
			})
			expect(config.key_action_events.length).toBeGreaterThan(0)
			expect(config.age_group_buckets.at(-1)?.maxAge).toBeNull()
		})

		it("saves values of every shape the registry carries", async () => {
			const saved = await save({
				leaderboard_enabled: true,
				trivia_repeat_days: 14,
				suppression_minimum: 25,
				recognition_confidence_threshold: 0.95,
				key_action_events: ["content_view", "survey_submitted"],
				age_group_buckets: [
					{ minAge: 0, maxAge: 20 },
					{ minAge: 21, maxAge: null },
				],
				active_privacy_notice_version: NOTICE_VERSION,
			})

			// A boolean, a number, a fraction, an enum list, a structured list and
			// a string all through the same registry.
			expect(saved).toMatchObject({
				leaderboard_enabled: true,
				trivia_repeat_days: 14,
				suppression_minimum: 25,
				recognition_confidence_threshold: 0.95,
				key_action_events: ["content_view", "survey_submitted"],
				active_privacy_notice_version: NOTICE_VERSION,
			})
			await expect(service.get()).resolves.toMatchObject(saved)
		})

		it("audits only the settings that moved, with what they were", async () => {
			await save({ leaderboard_enabled: true })

			const rows = await db.select().from(auditLog).orderBy(auditLog.id)
			expect(rows.map(row => row.targetId)).toEqual(["leaderboard_enabled"])
			expect(rows[0]).toMatchObject({
				domain: "pisocamp",
				action: "module_configuration.update",
				actorId: ADMIN_ID,
				targetType: "module_configuration",
				oldValue: false,
				newValue: true,
			})
		})

		it("writes nothing to the trail when nothing changed", async () => {
			await save({ leaderboard_enabled: true })
			await db.delete(auditLog)

			await save()

			// Re-saving the same screen is not a change, and a trail full of
			// unchanged values is one nobody reads.
			expect(await db.select().from(auditLog)).toHaveLength(0)
		})

		it("refuses to serve a stored value the contract would reject", async () => {
			await db.insert(moduleConfiguration).values([
				{ key: "suppression_minimum", value: 0, updatedBy: ADMIN_ID },
				{ key: "leaderboard_enabled", value: "yes", updatedBy: ADMIN_ID },
			])

			// A row somebody edited by hand is not a reason to serve a setting the
			// contract would refuse; the declared default is.
			await expect(service.get()).resolves.toMatchObject({
				suppression_minimum: 10,
				leaderboard_enabled: false,
			})
		})
	})

	describe("GM-4 — the leaderboard flag is a configuration key like any other", () => {
		it("turns the leaderboard on and audits who did it", async () => {
			const saved = await save({ leaderboard_enabled: true })

			expect(saved.leaderboard_enabled).toBe(true)
			const rows = await db.select().from(auditLog)
			expect(rows.map(row => row.targetId)).toEqual(["leaderboard_enabled"])
			// GM-4 AC6 is F2's gate: the handler carries `admin.config.manage`,
			// and both branches of it are proven in the configuration
			// authorization spec rather than a second time here.
			expect(rows[0]).toMatchObject({ actorId: ADMIN_ID, oldValue: false, newValue: true })
		})
	})

	describe("the active privacy notice version", () => {
		it("refuses a version that is not stored, and changes nothing", async () => {
			await expect(save({ active_privacy_notice_version: "not-a-version" })).rejects.toMatchObject(
				{ code: "BAD_REQUEST" }
			)

			// F4's consent flow reads this key and refuses to serve consent when it
			// names a notice that is not there, so a typo would take consent down
			// for everybody rather than fail in front of the person who made it.
			expect(await db.select().from(moduleConfiguration)).toHaveLength(0)
			expect(await db.select().from(auditLog)).toHaveLength(0)
		})

		it("lets the other settings be saved while a stored version is dangling", async () => {
			// The notice this points at is not stored — a state a dev database or
			// a botched import can be in. Refusing every save would leave nobody
			// able to change the session timeout until somebody fixed the notice.
			await db.insert(moduleConfiguration).values({
				key: "active_privacy_notice_version",
				value: "gone-missing",
				updatedBy: ADMIN_ID,
			})

			await expect(save({ leaderboard_enabled: true })).resolves.toMatchObject({
				leaderboard_enabled: true,
				active_privacy_notice_version: "gone-missing",
			})
		})

		it("clears the setting rather than storing an empty one", async () => {
			await save({ active_privacy_notice_version: NOTICE_VERSION })

			await save({ active_privacy_notice_version: null })

			// No value is the absence of the setting, which is what a missing row
			// already means — and a not-null column could not hold it anyway.
			const rows = await db
				.select()
				.from(moduleConfiguration)
				.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))
			expect(rows).toHaveLength(0)
			await expect(service.get()).resolves.toMatchObject({
				active_privacy_notice_version: null,
			})
		})

		it("leaves the key exactly where F4's consent flow looks for it", async () => {
			await save({ active_privacy_notice_version: NOTICE_VERSION })

			const [row] = await db
				.select()
				.from(moduleConfiguration)
				.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))
			// SA-3 provides the screen; F4 owns the meaning and reads this key by
			// name. Renaming or reshaping it here would break consent silently.
			expect(row?.value).toBe(NOTICE_VERSION)
		})
	})
})
