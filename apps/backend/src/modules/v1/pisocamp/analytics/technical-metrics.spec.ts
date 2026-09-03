import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"

import { analyticsEvents, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { MonitoringImportService } from "./monitoring-import.service"
import { TechnicalMetricsService } from "./technical-metrics.service"

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

const ADMIN_ID = "an7-admin"
const DEVICE = "AnSevenDeviceId0000001"

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour = 10) {
	return new Date(Date.UTC(2026, 8, day, hour - 8))
}

/**
 * AN-7. Two sources kept apart on purpose: crashes and API traffic are
 * imported from the monitoring tool, because a dead process and a request that
 * never arrived cannot report themselves; load times and network failures come
 * from the device, because only the device knows how long it waited.
 */
describe("AN-7 technical metrics", () => {
	let service: TechnicalMetricsService
	let imports: MonitoringImportService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table performance_test_result, api_endpoint_metric, crash_snapshot,
				analytics_event, audit_log, sessions, accounts, users
			restart identity cascade
		`)
		await db.insert(users).values({
			id: ADMIN_ID,
			name: "AN-7 admin",
			email: "an7-admin@example.test",
			emailVerified: true,
			createdAt: new Date("2026-09-01T00:00:00.000Z"),
			updatedAt: new Date("2026-09-01T00:00:00.000Z"),
		})
		service = new TechnicalMetricsService()
		imports = new MonitoringImportService(new AuditService())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function loadEvent(when: Date, durationMs: number, phase: "cold" | "warm" = "cold") {
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: "module_load",
			occurredAt: when,
			subjectPseudoId: DEVICE,
			sessionId: randomUUID(),
			accountType: "guest",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "online",
			screen: "pisocamp_home",
			feature: "module",
			status: "completed",
			properties: { phase, durationMs } as never,
		})
	}

	async function failureEvent(
		when: Date,
		failureType: "timeout" | "no_connectivity" | "sync_failed" | "download_failed",
		operation: "config" | "bundle" | "events" = "bundle"
	) {
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: "network_failure",
			occurredAt: when,
			subjectPseudoId: DEVICE,
			sessionId: randomUUID(),
			accountType: "guest",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "offline",
			screen: "pisocamp_home",
			feature: "module",
			status: "failed",
			properties: { failureType, operation } as never,
		})
	}

	const period = {
		source: "sentry",
		periodStart: "2026-09-01",
		periodEnd: "2026-09-07",
	}

	describe("AC1 — crash figures from the monitoring tool", () => {
		it("reports the count, who and what it touched, and the crash-free rate", async () => {
			await imports.importMetrics(
				{
					...period,
					crashes: {
						crashCount: 12,
						affectedUsers: 7,
						affectedSessions: 10,
						totalSessions: 1000,
					},
					endpoints: [],
				},
				ADMIN_ID
			)

			const summary = await service.summary(RANGE)

			expect(summary.crashes).toMatchObject({
				source: "sentry",
				crashCount: 12,
				affectedUsers: 7,
				affectedSessions: 10,
				totalSessions: 1000,
				// Twelve crashes across a thousand sessions.
				crashesPerSession: 0.012,
				// Ten sessions of a thousand crashed.
				crashFreeSessionRatePercent: 99,
			})
		})

		it("says nothing was imported rather than reporting no crashes", async () => {
			const summary = await service.summary(RANGE)

			// Zero crashes and no data are different claims, and only one of
			// them is good news.
			expect(summary.crashes).toBeNull()
		})

		it("replaces a period on re-import instead of adding to it", async () => {
			const payload = {
				...period,
				crashes: {
					crashCount: 12,
					affectedUsers: 7,
					affectedSessions: 10,
					totalSessions: 1000,
				},
				endpoints: [],
			}
			await imports.importMetrics(payload, ADMIN_ID)
			await imports.importMetrics(payload, ADMIN_ID)

			const summary = await service.summary(RANGE)

			// A retried import after a dropped connection must not double a
			// crash count.
			expect(summary.crashes).toMatchObject({ crashCount: 12 })
		})

		it("records who imported the figures", async () => {
			await imports.importMetrics(
				{
					...period,
					crashes: {
						crashCount: 1,
						affectedUsers: 1,
						affectedSessions: 1,
						totalSessions: 10,
					},
					endpoints: [],
				},
				ADMIN_ID
			)

			const rows = await db.execute<{ actorId: string; targetId: string }>(sql`
				select actor_id as "actorId", target_id as "targetId"
				from audit_log where action = 'monitoring.import'
			`)
			expect(rows.rows).toEqual([
				{ actorId: ADMIN_ID, targetId: "sentry:2026-09-01:2026-09-07" },
			])
		})
	})

	describe("AC2 — load-time percentiles from the module's own events", () => {
		it("reports p50, p95 and max", async () => {
			for (const duration of [100, 200, 300, 400, 500, 600, 700, 800, 900, 5000]) {
				await loadEvent(manila(2), duration)
			}

			const summary = await service.summary(RANGE)

			expect(summary.loadTime).toMatchObject({
				samples: 10,
				p50Ms: 550,
				p95Ms: 3155,
				maxMs: 5000,
			})
		})

		it("keeps cold and warm starts apart", async () => {
			await loadEvent(manila(2), 2000, "cold")
			await loadEvent(manila(2), 300, "warm")
			await loadEvent(manila(3), 250, "warm")

			const summary = await service.summary(RANGE)

			// A cold start pays for the process as well as the module, and one
			// figure would hide which of them got slower.
			expect(summary.loadTime).toMatchObject({ coldSamples: 1, warmSamples: 2 })
		})

		it("says there is no percentile rather than reporting a zero", async () => {
			const summary = await service.summary(RANGE)

			expect(summary.loadTime).toMatchObject({
				samples: 0,
				p50Ms: null,
				p95Ms: null,
				maxMs: null,
			})
		})

		it("leaves out loads from outside the range", async () => {
			await loadEvent(manila(2), 400)
			await loadEvent(new Date(Date.UTC(2026, 9, 2)), 9000)

			const summary = await service.summary(RANGE)

			expect(summary.loadTime).toMatchObject({ samples: 1, maxMs: 400 })
		})
	})

	describe("AC3 — API figures per endpoint", () => {
		it("reports requests, latency, errors, timeouts and auth failures", async () => {
			await imports.importMetrics(
				{
					...period,
					crashes: null,
					endpoints: [
						{
							endpoint: "GET /pisocamp/config",
							requestCount: 1000,
							errorCount: 20,
							timeoutCount: 5,
							authFailureCount: 2,
							latencyP50Ms: 40,
							latencyP95Ms: 180,
						},
						{
							endpoint: "POST /pisocamp/events",
							requestCount: 400,
							errorCount: 0,
							timeoutCount: 1,
							authFailureCount: 0,
							latencyP50Ms: 60,
							latencyP95Ms: 250,
						},
					],
				},
				ADMIN_ID
			)

			const summary = await service.summary(RANGE)

			expect(summary.endpoints).toEqual([
				{
					endpoint: "GET /pisocamp/config",
					requestCount: 1000,
					errorCount: 20,
					errorRatePercent: 2,
					timeoutCount: 5,
					authFailureCount: 2,
					latencyP50Ms: 40,
					latencyP95Ms: 180,
				},
				{
					endpoint: "POST /pisocamp/events",
					requestCount: 400,
					errorCount: 0,
					errorRatePercent: 0,
					timeoutCount: 1,
					authFailureCount: 0,
					latencyP50Ms: 60,
					latencyP95Ms: 250,
				},
			])
		})

		it("takes the worst period rather than averaging percentiles", async () => {
			const endpoint = {
				endpoint: "GET /pisocamp/config",
				requestCount: 100,
				errorCount: 0,
				timeoutCount: 0,
				authFailureCount: 0,
				latencyP50Ms: 40,
				latencyP95Ms: 100,
			}
			await imports.importMetrics(
				{ ...period, crashes: null, endpoints: [endpoint] },
				ADMIN_ID
			)
			await imports.importMetrics(
				{
					source: "sentry",
					periodStart: "2026-09-08",
					periodEnd: "2026-09-14",
					crashes: null,
					endpoints: [{ ...endpoint, latencyP50Ms: 90, latencyP95Ms: 400 }],
				},
				ADMIN_ID
			)

			const summary = await service.summary(RANGE)

			// Percentiles do not add, so an average of them would report a
			// latency nobody ever saw.
			expect(summary.endpoints[0]).toMatchObject({
				requestCount: 200,
				latencyP50Ms: 90,
				latencyP95Ms: 400,
			})
		})

		it("ignores a period that only half overlaps the range", async () => {
			await imports.importMetrics(
				{
					source: "sentry",
					periodStart: "2026-08-28",
					periodEnd: "2026-09-03",
					crashes: {
						crashCount: 5,
						affectedUsers: 5,
						affectedSessions: 5,
						totalSessions: 50,
					},
					endpoints: [],
				},
				ADMIN_ID
			)

			const summary = await service.summary(RANGE)

			// Half a period's crashes against a full period's sessions is not a
			// rate anybody should read.
			expect(summary.crashes).toBeNull()
		})
	})

	describe("AC4 — network failures by type", () => {
		it("counts each kind, including the ones nothing reported", async () => {
			await failureEvent(manila(2), "timeout")
			await failureEvent(manila(2), "timeout")
			await failureEvent(manila(3), "no_connectivity")
			await failureEvent(manila(4), "download_failed")

			const summary = await service.summary(RANGE)

			expect(summary.networkFailureTotal).toBe(4)
			expect(summary.networkFailures).toEqual([
				{ failureType: "timeout", count: 2 },
				{ failureType: "no_connectivity", count: 1 },
				// Nothing reported these, and a missing row would read as a
				// failure that cannot happen.
				{ failureType: "sync_failed", count: 0 },
				{ failureType: "download_failed", count: 1 },
				{ failureType: "report_failed", count: 0 },
				{ failureType: "upload_failed", count: 0 },
			])
		})
	})

	describe("AC5 — the performance test run, entered by hand", () => {
		const entry = {
			testedAt: "2026-09-05",
			appVersion: "1.2.0+8",
			platform: "android" as const,
			deviceModel: "Pixel 7a",
			appSizeMb: 84.5,
			moduleSizeIncreaseMb: 12.25,
			downloadedAssetsMb: 30,
			localStorageMb: 45.75,
			batteryImpactPercent: 3.5,
			notes: "Thirty minutes of continuous use on Wi-Fi.",
		}

		it("records the entry with who entered it and shows it in the range", async () => {
			const stored = await imports.recordPerformanceTest(entry, ADMIN_ID)

			expect(stored).toMatchObject({ ...entry, recordedBy: ADMIN_ID })

			const summary = await service.summary(RANGE)
			expect(summary.performanceTests).toHaveLength(1)
			expect(summary.performanceTests[0]).toMatchObject({
				appVersion: "1.2.0+8",
				appSizeMb: 84.5,
				moduleSizeIncreaseMb: 12.25,
				downloadedAssetsMb: 30,
				localStorageMb: 45.75,
				batteryImpactPercent: 3.5,
				recordedBy: ADMIN_ID,
			})
		})

		it("audits the entry, because a figure nobody stands behind is not evidence", async () => {
			await imports.recordPerformanceTest(entry, ADMIN_ID)

			const rows = await db.execute<{ actorId: string; action: string }>(sql`
				select actor_id as "actorId", action from audit_log
				where action = 'performance_test.record'
			`)
			expect(rows.rows).toEqual([
				{ actorId: ADMIN_ID, action: "performance_test.record" },
			])
		})

		it("leaves out a run tested outside the range", async () => {
			await imports.recordPerformanceTest({ ...entry, testedAt: "2026-10-05" }, ADMIN_ID)

			const summary = await service.summary(RANGE)

			expect(summary.performanceTests).toEqual([])
		})
	})
})
