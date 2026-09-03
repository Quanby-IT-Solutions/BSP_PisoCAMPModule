import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import { ANALYTICS_NETWORK_FAILURE_TYPES } from "@repo/contracts/pisocamp-analytics"
import type { TechnicalMetricsSummary } from "@repo/contracts/pisocamp-technical"

import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

const MANILA = "Asia/Manila"

@Injectable()
export class TechnicalMetricsService {
	/**
	 * Technical health for a range of Asia/Manila days.
	 *
	 * Two sources, deliberately kept apart. Crashes and API traffic are
	 * imported from the monitoring tool, because a process that has died and a
	 * request that never arrived cannot report themselves. Load times and
	 * network failures come from the module's own events, because only the
	 * device knows how long it waited.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["technical"]
	): Promise<TechnicalMetricsSummary> {
		const range = sql`
			e.occurred_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and e.occurred_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`
		// A snapshot counts when its whole period falls inside the range: half a
		// period's crashes against a full period's sessions is not a rate.
		const covered = sql`
			period_start >= ${input.from}::date and period_end <= ${input.to}::date
		`

		const [crashRow] = (
			await db.execute<{
				sources: string | null
				crashCount: string
				affectedUsers: string
				affectedSessions: string
				totalSessions: string
				periods: string
			}>(sql`
				select
					string_agg(distinct source, ', ' order by source) as "sources",
					coalesce(sum(crash_count), 0)::text as "crashCount",
					coalesce(sum(affected_users), 0)::text as "affectedUsers",
					coalesce(sum(affected_sessions), 0)::text as "affectedSessions",
					coalesce(sum(total_sessions), 0)::text as "totalSessions",
					count(*)::text as "periods"
				from crash_snapshot
				where ${covered}
			`)
		).rows

		const [load] = (
			await db.execute<{
				samples: string
				p50: string | null
				p95: string | null
				max: string | null
				cold: string
				warm: string
			}>(sql`
				with durations as (
					select
						((e.properties ->> 'durationMs')::int) as duration_ms,
						(e.properties ->> 'phase') as phase
					from analytics_event e
					where ${range} and e.event_name = 'module_load'
				)
				select
					count(*)::text as "samples",
					round(percentile_cont(0.5) within group (order by duration_ms))::text as "p50",
					round(percentile_cont(0.95) within group (order by duration_ms))::text as "p95",
					max(duration_ms)::text as "max",
					count(*) filter (where phase = 'cold')::text as "cold",
					count(*) filter (where phase = 'warm')::text as "warm"
				from durations
			`)
		).rows

		const endpoints = (
			await db.execute<{
				endpoint: string
				requestCount: string
				errorCount: string
				timeoutCount: string
				authFailureCount: string
				latencyP50Ms: string
				latencyP95Ms: string
			}>(sql`
				select
					endpoint as "endpoint",
					sum(request_count)::text as "requestCount",
					sum(error_count)::text as "errorCount",
					sum(timeout_count)::text as "timeoutCount",
					sum(auth_failure_count)::text as "authFailureCount",
					-- The worst period in the range, not an average of
					-- percentiles: percentiles do not add, and averaging them
					-- would report a latency nobody ever saw.
					max(latency_p50_ms)::text as "latencyP50Ms",
					max(latency_p95_ms)::text as "latencyP95Ms"
				from api_endpoint_metric
				where ${covered}
				group by endpoint
				order by sum(request_count) desc, endpoint
			`)
		).rows

		const failures = (
			await db.execute<{ failureType: string; count: string }>(sql`
				select
					(e.properties ->> 'failureType') as "failureType",
					count(*)::text as "count"
				from analytics_event e
				where ${range} and e.event_name = 'network_failure'
				group by 1
			`)
		).rows

		const tests = (
			await db.execute<{
				id: string
				testedAt: string
				appVersion: string
				platform: "android" | "ios"
				deviceModel: string
				appSizeMb: number
				moduleSizeIncreaseMb: number
				downloadedAssetsMb: number
				localStorageMb: number
				batteryImpactPercent: number
				notes: string | null
				recordedBy: string
				recordedAt: Date
			}>(sql`
				select
					id::text as "id",
					tested_at::text as "testedAt",
					app_version as "appVersion",
					platform as "platform",
					device_model as "deviceModel",
					app_size_mb as "appSizeMb",
					module_size_increase_mb as "moduleSizeIncreaseMb",
					downloaded_assets_mb as "downloadedAssetsMb",
					local_storage_mb as "localStorageMb",
					battery_impact_percent as "batteryImpactPercent",
					notes as "notes",
					recorded_by as "recordedBy",
					recorded_at as "recordedAt"
				from performance_test_result
				where tested_at between ${input.from}::date and ${input.to}::date
				order by tested_at desc, recorded_at desc
			`)
		).rows

		const counted = new Map(failures.map(row => [row.failureType, Number(row.count)]))
		const crashCount = Number(crashRow?.crashCount ?? 0)
		const totalSessions = Number(crashRow?.totalSessions ?? 0)
		const affectedSessions = Number(crashRow?.affectedSessions ?? 0)

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			// Null rather than zeros: nothing imported and nothing crashed are
			// different claims, and only one of them is good news.
			crashes:
				Number(crashRow?.periods ?? 0) === 0
					? null
					: {
							source: crashRow?.sources ?? "unknown",
							crashCount,
							affectedUsers: Number(crashRow?.affectedUsers ?? 0),
							affectedSessions,
							totalSessions,
							crashesPerSession:
								totalSessions === 0
									? 0
									: Math.round((crashCount / totalSessions) * 10_000) / 10_000,
							crashFreeSessionRatePercent:
								totalSessions === 0
									? 0
									: this.rate(totalSessions - affectedSessions, totalSessions),
						},
			loadTime: {
				samples: Number(load?.samples ?? 0),
				p50Ms: load?.p50 === null || load?.p50 === undefined ? null : Number(load.p50),
				p95Ms: load?.p95 === null || load?.p95 === undefined ? null : Number(load.p95),
				maxMs: load?.max === null || load?.max === undefined ? null : Number(load.max),
				coldSamples: Number(load?.cold ?? 0),
				warmSamples: Number(load?.warm ?? 0),
			},
			endpoints: endpoints.map(row => {
				const requests = Number(row.requestCount)
				const errors = Number(row.errorCount)
				return {
					endpoint: row.endpoint,
					requestCount: requests,
					errorCount: errors,
					errorRatePercent: this.rate(errors, requests),
					timeoutCount: Number(row.timeoutCount),
					authFailureCount: Number(row.authFailureCount),
					latencyP50Ms: Number(row.latencyP50Ms),
					latencyP95Ms: Number(row.latencyP95Ms),
				}
			}),
			// Every kind, including the ones nothing reported: a missing row
			// reads as a failure that cannot happen.
			networkFailures: ANALYTICS_NETWORK_FAILURE_TYPES.map(failureType => ({
				failureType,
				count: counted.get(failureType) ?? 0,
			})),
			networkFailureTotal: failures.reduce((sum, row) => sum + Number(row.count), 0),
			performanceTests: tests.map(row => ({
				id: row.id,
				testedAt: row.testedAt,
				appVersion: row.appVersion,
				platform: row.platform,
				deviceModel: row.deviceModel,
				appSizeMb: row.appSizeMb,
				moduleSizeIncreaseMb: row.moduleSizeIncreaseMb,
				downloadedAssetsMb: row.downloadedAssetsMb,
				localStorageMb: row.localStorageMb,
				batteryImpactPercent: row.batteryImpactPercent,
				notes: row.notes,
				recordedBy: row.recordedBy,
				recordedAt: new Date(row.recordedAt).toISOString(),
			})),
		}
	}

	/** Zero rather than a division by zero: an empty pool has no rate. */
	private rate(part: number, whole: number): number {
		if (whole === 0) return 0
		return Math.min(100, Math.round((part / whole) * 10_000) / 100)
	}
}
