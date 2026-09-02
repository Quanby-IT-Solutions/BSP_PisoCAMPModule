import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"

import { REPORT_DEFINITIONS } from "@repo/contracts/pisocamp-report"
import { analyticsEvents, auditLog, reportDefinitions, reportRuns } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { AdoptionService } from "../analytics/adoption.service"
import { EngagementService } from "../analytics/engagement.service"
import { RetentionService } from "../analytics/retention.service"
import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { ActivityService } from "./activity.service"
import { ReportService } from "./report.service"

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

const ACTOR_ID = "an8-actor"

const ALICE = "AnEightAliceSubject001"
const BOB = "AnEightBobSubjectId002"

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour: number) {
	return new Date(Date.UTC(2026, 7, day, hour - 8))
}

function event(
	subjectPseudoId: string,
	occurredAt: Date,
	overrides: Partial<typeof analyticsEvents.$inferInsert> = {}
) {
	return {
		eventId: randomUUID(),
		schemaVersion: 1,
		eventName: "module_entry" as const,
		occurredAt,
		subjectPseudoId,
		sessionId: randomUUID(),
		accountType: "guest" as const,
		screen: "pisocamp_home",
		feature: "module",
		appVersion: "1.0.0",
		osName: "android" as const,
		osVersion: "15",
		deviceCategory: "phone" as const,
		networkState: "online" as const,
		status: "completed" as const,
		properties: { entryPoint: "navigation" } as never,
		...overrides,
	}
}

/**
 * AN-8. The framework is proved by what it does not know: it runs, records and
 * audits reports without naming one, and the figures it records are recomputed
 * here by hand from a fixture small enough to hold in your head.
 */
describe("AN-8 parameter-driven historical reports", () => {
	let reports: ReportService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table report_run, report_definition, analytics_session, analytics_event,
			module_configuration, audit_log, users restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ACTOR_ID}, 'AN8 Actor', 'an8-actor@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		const config = new PisoCampAdminConfigService(new AuditService())
		reports = new ReportService(
			new EngagementService(config),
			new RetentionService(config),
			new AdoptionService(),
			new ActivityService(),
			new AuditService()
		)
		await db.delete(reportRuns)
		await db.delete(reportDefinitions)
		await db.delete(analyticsEvents)
		await db.delete(auditLog)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	function request(overrides: Record<string, unknown> = {}) {
		return {
			id: randomUUID(),
			definitionKey: "activity" as const,
			from: "2026-08-10",
			to: "2026-08-11",
			filters: {},
			actorId: ACTOR_ID,
			...overrides,
		}
	}

	describe("AC1 — a report says what it is, when it ran and what it covered", () => {
		it("returns the generation date, parameters, period and data source", async () => {
			await db.insert(analyticsEvents).values([event(ALICE, manila(10, 10))])

			const run = await reports.generate(request({ filters: { os: "android" } }))

			expect(run).toMatchObject({
				definitionKey: "activity",
				definitionName: "Activity",
				dataSource: "analytics_event",
				from: "2026-08-10",
				to: "2026-08-11",
				timezone: "Asia/Manila",
				filters: { os: "android" },
				generatedBy: ACTOR_ID,
				suppressed: false,
			})
			expect(Date.parse(run.generatedAt)).not.toBeNaN()
		})

		it("applies a filter from the approved list", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10)),
				event(BOB, manila(10, 11), { osName: "ios", deviceCategory: "tablet" }),
			])

			const android = await reports.generate(request({ filters: { os: "android" } }))
			const all = await reports.generate(request())

			expect(android.result).toMatchObject({
				definitionKey: "activity",
				activity: { totalEvents: 1, distinctUsers: 1 },
			})
			expect(all.result).toMatchObject({ activity: { totalEvents: 2, distinctUsers: 2 } })
		})

		it("refuses a filter the report cannot apply, by name", async () => {
			// Quietly dropping it would answer a different question from the one
			// that was asked, under the name of the one that was asked.
			await expect(
				reports.generate(
					request({ definitionKey: "engagement", filters: { appVersion: "1.0.0" } })
				)
			).rejects.toMatchObject({ message: expect.stringContaining("cannot filter by appVersion") })
		})

		it("counts activity by name and by day, and every day in the range", async () => {
			await db.insert(analyticsEvents).values([
				event(ALICE, manila(10, 10)),
				event(ALICE, manila(10, 11), {
					eventName: "content_view",
					screen: "currency_detail",
					feature: "currency_education",
					properties: { logicalId: "content.one" } as never,
				}),
				event(BOB, manila(11, 9)),
			])

			const run = await reports.generate(request({ from: "2026-08-10", to: "2026-08-12" }))

			expect(run.result).toMatchObject({
				activity: {
					totalEvents: 3,
					distinctUsers: 2,
					byEvent: [
						{ eventName: "module_entry", events: 2, users: 2 },
						{ eventName: "content_view", events: 1, users: 1 },
					],
					byDay: [
						{ date: "2026-08-10", events: 2 },
						{ date: "2026-08-11", events: 1 },
						// A quiet day is a row of zero, not a missing row.
						{ date: "2026-08-12", events: 0 },
					],
				},
			})
		})
	})

	describe("AC2 — a historical report keeps saying what it said", () => {
		it("stores the figures rather than recomputing them on read", async () => {
			await db.insert(analyticsEvents).values([event(ALICE, manila(10, 10))])
			const run = await reports.generate(request())

			// A later upload lands for a day the report already covered.
			await db.insert(analyticsEvents).values([event(BOB, manila(10, 12))])
			const { runs } = await reports.listRuns({ limit: 10 })

			expect(runs).toHaveLength(1)
			expect(runs[0]?.result).toMatchObject({ activity: { totalEvents: 1 } })
			expect(runs[0]?.id).toBe(run.id)
		})

		it("returns the first run when the same request is replayed", async () => {
			await db.insert(analyticsEvents).values([event(ALICE, manila(10, 10))])
			const id = randomUUID()

			const first = await reports.generate(request({ id }))
			await db.insert(analyticsEvents).values([event(BOB, manila(10, 12))])
			const replay = await reports.generate(request({ id }))

			expect(replay).toEqual(first)
			expect(await db.select().from(reportRuns)).toHaveLength(1)
		})
	})

	describe("AC3 — a new KPI is a registry entry", () => {
		it("lists every definition with the filters it can apply", async () => {
			const { definitions } = reports.listDefinitions()

			expect(definitions.map(definition => definition.key).sort()).toEqual(
				REPORT_DEFINITIONS.map(definition => definition.key).sort()
			)
			expect(definitions.find(definition => definition.key === "engagement")).toMatchObject({
				dataSource: "analytics_session",
				filters: [],
			})
		})

		it("records the definition it ran, without needing a migration or a boot step", async () => {
			// The row is written when the report runs. Making the whole API's
			// start-up depend on copying a list that already lives in the code
			// would be a worse outage than the one it guarded against.
			await reports.generate(request({ definitionKey: "adoption" }))

			const rows = await db.execute<{ key: string; dataSource: string }>(
				sql`select key, data_source as "dataSource" from report_definition order by key`
			)
			expect(rows.rows).toEqual([{ key: "adoption", dataSource: "analytics_event" }])
		})

		it("runs every registered definition without the framework naming one", async () => {
			await db.insert(analyticsEvents).values([event(ALICE, manila(10, 10))])

			for (const definition of REPORT_DEFINITIONS) {
				const run = await reports.generate(request({ definitionKey: definition.key }))
				expect(run.result).toMatchObject({ definitionKey: definition.key })
			}
		})
	})

	describe("AC4 — a run and an audit entry are written", () => {
		it("records the run and audits the generation together", async () => {
			await db.insert(analyticsEvents).values([event(ALICE, manila(10, 10))])
			const id = randomUUID()

			await reports.generate(request({ id, filters: { os: "android" } }))

			const [row] = await db.select().from(reportRuns).where(eq(reportRuns.id, id))
			expect(row).toMatchObject({
				definitionKey: "activity",
				requestedBy: ACTOR_ID,
				fromDate: "2026-08-10",
				toDate: "2026-08-11",
				suppressed: false,
			})

			const audits = await db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.action, "report.generate"), eq(auditLog.targetId, id)))
			expect(audits).toHaveLength(1)
			expect(audits[0]).toMatchObject({
				domain: "pisocamp",
				actorId: ACTOR_ID,
				targetType: "report_run",
				outcome: "success",
			})
			expect(audits[0]?.newValue).toMatchObject({
				definitionKey: "activity",
				filters: { os: "android" },
				suppressed: false,
			})
		})

		it("does not write a run when the report itself fails", async () => {
			await expect(
				reports.generate(
					request({ definitionKey: "retention", filters: { appVersion: "1.0.0" } })
				)
			).rejects.toBeDefined()

			expect(await db.select().from(reportRuns)).toHaveLength(0)
			expect(await db.select().from(auditLog)).toHaveLength(0)
		})
	})

	describe("demographic filters wait for AN-10", () => {
		it("withholds the figures and says why", async () => {
			await db.insert(analyticsEvents).values([event(ALICE, manila(10, 10))])

			const run = await reports.generate(request({ filters: { gender: "female" } }))

			// A demographic cut of people who never consented to demographic
			// analytics is the report F4 exists to prevent.
			expect(run).toMatchObject({
				suppressed: true,
				result: null,
				suppressionReason: expect.stringContaining("AN-10"),
			})
		})

		it("records the withheld run and audits it like any other", async () => {
			const id = randomUUID()

			await reports.generate(request({ id, filters: { region: "0123456789" } }))

			const [row] = await db.select().from(reportRuns).where(eq(reportRuns.id, id))
			expect(row).toMatchObject({ suppressed: true, result: null })
			const audits = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.targetId, id))
			expect(audits).toHaveLength(1)
			expect(audits[0]?.newValue).toMatchObject({ suppressed: true })
		})
	})
})
