import { Injectable } from "@nestjs/common"
import { and, eq } from "drizzle-orm"

import type {
	ImportMonitoringMetricsInput,
	PerformanceTestResultView,
	RecordPerformanceTestInput,
} from "@repo/contracts/pisocamp-technical"
import { apiEndpointMetrics, crashSnapshots, performanceTestResults } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

@Injectable()
export class MonitoringImportService {
	constructor(private readonly audit: AuditService) {}

	/**
	 * The §12 import: one period of figures from the monitoring tool.
	 *
	 * Replaces the period rather than adding to it, so a retried import after a
	 * dropped connection cannot double a crash count. The audit entry names the
	 * source and period, because a figure nobody is accountable for is not
	 * evidence.
	 */
	async importMetrics(input: ImportMonitoringMetricsInput, actorId: string) {
		return db.transaction(async tx => {
			await tx
				.delete(crashSnapshots)
				.where(
					and(
						eq(crashSnapshots.source, input.source),
						eq(crashSnapshots.periodStart, input.periodStart),
						eq(crashSnapshots.periodEnd, input.periodEnd)
					)
				)
			await tx
				.delete(apiEndpointMetrics)
				.where(
					and(
						eq(apiEndpointMetrics.source, input.source),
						eq(apiEndpointMetrics.periodStart, input.periodStart),
						eq(apiEndpointMetrics.periodEnd, input.periodEnd)
					)
				)

			if (input.crashes) {
				await tx.insert(crashSnapshots).values({
					source: input.source,
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					crashCount: input.crashes.crashCount,
					affectedUsers: input.crashes.affectedUsers,
					affectedSessions: input.crashes.affectedSessions,
					totalSessions: input.crashes.totalSessions,
					importedBy: actorId,
				})
			}
			if (input.endpoints.length > 0) {
				await tx.insert(apiEndpointMetrics).values(
					input.endpoints.map(endpoint => ({
						source: input.source,
						periodStart: input.periodStart,
						periodEnd: input.periodEnd,
						endpoint: endpoint.endpoint,
						requestCount: endpoint.requestCount,
						errorCount: endpoint.errorCount,
						timeoutCount: endpoint.timeoutCount,
						authFailureCount: endpoint.authFailureCount,
						latencyP50Ms: endpoint.latencyP50Ms,
						latencyP95Ms: endpoint.latencyP95Ms,
						importedBy: actorId,
					}))
				)
			}

			await this.audit.record(
				{
					domain: "pisocamp",
					action: "monitoring.import",
					actorId,
					targetType: "monitoring_period",
					targetId: `${input.source}:${input.periodStart}:${input.periodEnd}`,
					newValue: {
						crashesImported: input.crashes !== null,
						endpointsImported: input.endpoints.length,
					},
				},
				tx
			)

			return {
				source: input.source,
				periodStart: input.periodStart,
				periodEnd: input.periodEnd,
				crashesImported: input.crashes !== null,
				endpointsImported: input.endpoints.length,
			}
		})
	}

	/**
	 * AN-025's manual entry.
	 *
	 * These figures come from a measured build on real hardware, so the row
	 * records who entered them and the audit says so too: a size or a battery
	 * figure with nobody behind it cannot be checked by anybody later.
	 */
	async recordPerformanceTest(
		input: RecordPerformanceTestInput,
		actorId: string
	): Promise<PerformanceTestResultView> {
		return db.transaction(async tx => {
			const [stored] = await tx
				.insert(performanceTestResults)
				.values({
					testedAt: input.testedAt,
					appVersion: input.appVersion,
					platform: input.platform,
					deviceModel: input.deviceModel,
					appSizeMb: input.appSizeMb,
					moduleSizeIncreaseMb: input.moduleSizeIncreaseMb,
					downloadedAssetsMb: input.downloadedAssetsMb,
					localStorageMb: input.localStorageMb,
					batteryImpactPercent: input.batteryImpactPercent,
					notes: input.notes,
					recordedBy: actorId,
				})
				.returning()

			await this.audit.record(
				{
					domain: "pisocamp",
					action: "performance_test.record",
					actorId,
					targetType: "performance_test_result",
					targetId: stored!.id,
					newValue: {
						testedAt: input.testedAt,
						appVersion: input.appVersion,
						platform: input.platform,
					},
				},
				tx
			)

			return {
				id: stored!.id,
				testedAt: stored!.testedAt,
				appVersion: stored!.appVersion,
				platform: stored!.platform,
				deviceModel: stored!.deviceModel,
				appSizeMb: stored!.appSizeMb,
				moduleSizeIncreaseMb: stored!.moduleSizeIncreaseMb,
				downloadedAssetsMb: stored!.downloadedAssetsMb,
				localStorageMb: stored!.localStorageMb,
				batteryImpactPercent: stored!.batteryImpactPercent,
				notes: stored!.notes,
				recordedBy: stored!.recordedBy,
				recordedAt: stored!.recordedAt.toISOString(),
			}
		})
	}
}
