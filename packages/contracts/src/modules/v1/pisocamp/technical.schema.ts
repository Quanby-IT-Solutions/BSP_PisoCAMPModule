import { z } from "zod"

import { ANALYTICS_NETWORK_FAILURE_TYPES } from "./analytics.schema.js"
import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)
const Megabytes = z.number().min(0).max(100_000)

/** Where a set of imported figures came from, per the §12 interface. */
export const MonitoringSourceSchema = z.string().trim().min(1).max(64)

/**
 * AN-021. Crashes for the period, as the monitoring tool saw them.
 *
 * A process that has died cannot report its own death, so these figures are
 * imported rather than derived from the module's events. Every field is
 * nullable-free but the whole block is null when nothing has been imported for
 * the range: zero crashes and no data are different claims.
 */
export const CrashMetricsSchema = z
	.object({
		source: MonitoringSourceSchema,
		crashCount: NonNegativeInt,
		affectedUsers: NonNegativeInt,
		affectedSessions: NonNegativeInt,
		totalSessions: NonNegativeInt,
		/** Crashes ÷ sessions, to four decimals. */
		crashesPerSession: z.number().min(0),
		crashFreeSessionRatePercent: Ratio,
	})
	.strict()

/** AN-022. How long the module took to become usable. */
export const LoadTimeMetricsSchema = z
	.object({
		samples: NonNegativeInt,
		p50Ms: NonNegativeInt.nullable(),
		p95Ms: NonNegativeInt.nullable(),
		maxMs: NonNegativeInt.nullable(),
		/** Cold and warm starts pay for different things, so they are apart. */
		coldSamples: NonNegativeInt,
		warmSamples: NonNegativeInt,
	})
	.strict()

/** AN-023. One endpoint's traffic and health for the period. */
export const ApiEndpointMetricSchema = z
	.object({
		endpoint: z.string().trim().min(1).max(200),
		requestCount: NonNegativeInt,
		errorCount: NonNegativeInt,
		errorRatePercent: Ratio,
		timeoutCount: NonNegativeInt,
		authFailureCount: NonNegativeInt,
		latencyP50Ms: NonNegativeInt,
		latencyP95Ms: NonNegativeInt,
	})
	.strict()

/** AN-024. Failures a device met, counted by kind. */
export const NetworkFailureCountSchema = z
	.object({
		failureType: z.enum(ANALYTICS_NETWORK_FAILURE_TYPES),
		count: NonNegativeInt,
	})
	.strict()

/** AN-025. One measured build, entered by hand. */
export const PerformanceTestResultSchema = z
	.object({
		id: z.uuid(),
		testedAt: z.iso.date(),
		appVersion: z.string().trim().min(1).max(64),
		platform: z.enum(["android", "ios"]),
		deviceModel: z.string().trim().min(1).max(120),
		appSizeMb: Megabytes,
		moduleSizeIncreaseMb: Megabytes,
		downloadedAssetsMb: Megabytes,
		localStorageMb: Megabytes,
		batteryImpactPercent: Ratio,
		notes: z.string().trim().min(1).max(1000).nullable(),
		recordedBy: z.string(),
		recordedAt: z.iso.datetime({ offset: true }),
	})
	.strict()

export const RecordPerformanceTestInputSchema = z
	.object({
		testedAt: z.iso.date(),
		appVersion: z.string().trim().min(1).max(64),
		platform: z.enum(["android", "ios"]),
		deviceModel: z.string().trim().min(1).max(120),
		appSizeMb: Megabytes.refine(value => value > 0, "The app has a size"),
		moduleSizeIncreaseMb: Megabytes,
		downloadedAssetsMb: Megabytes,
		localStorageMb: Megabytes,
		batteryImpactPercent: Ratio,
		notes: z.string().trim().min(1).max(1000).nullable().default(null),
	})
	.strict()

/**
 * The §12 import interface: one period of figures from the monitoring tool.
 *
 * Importing the same period twice replaces it rather than adding to it, so a
 * retried import cannot double a crash count.
 */
export const ImportMonitoringMetricsInputSchema = z
	.object({
		source: MonitoringSourceSchema,
		periodStart: z.iso.date(),
		periodEnd: z.iso.date(),
		crashes: z
			.object({
				crashCount: NonNegativeInt,
				affectedUsers: NonNegativeInt,
				affectedSessions: NonNegativeInt,
				totalSessions: NonNegativeInt,
			})
			.strict()
			.nullable()
			.default(null),
		endpoints: z
			.array(
				z
					.object({
						endpoint: z.string().trim().min(1).max(200),
						requestCount: NonNegativeInt,
						errorCount: NonNegativeInt,
						timeoutCount: NonNegativeInt,
						authFailureCount: NonNegativeInt,
						latencyP50Ms: NonNegativeInt,
						latencyP95Ms: NonNegativeInt,
					})
					.strict()
			)
			.max(200)
			.default([]),
	})
	.strict()
	.refine(input => input.periodStart <= input.periodEnd, {
		message: "The period must start on or before it ends",
		path: ["periodEnd"],
	})
	.refine(
		input =>
			input.crashes === null ||
			input.crashes.affectedSessions <= input.crashes.totalSessions,
		{
			message: "More sessions crashed than the tool saw",
			path: ["crashes", "affectedSessions"],
		}
	)
	.refine(
		input =>
			input.endpoints.every(
				endpoint =>
					endpoint.errorCount <= endpoint.requestCount &&
					endpoint.timeoutCount <= endpoint.requestCount &&
					endpoint.authFailureCount <= endpoint.requestCount &&
					endpoint.latencyP95Ms >= endpoint.latencyP50Ms
			),
		{ message: "An endpoint reported more failures than requests", path: ["endpoints"] }
	)

export const ImportMonitoringMetricsOutputSchema = z
	.object({
		source: MonitoringSourceSchema,
		periodStart: z.iso.date(),
		periodEnd: z.iso.date(),
		crashesImported: z.boolean(),
		endpointsImported: NonNegativeInt,
	})
	.strict()

export const TechnicalMetricsSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** Null when nothing has been imported for the range. */
		crashes: CrashMetricsSchema.nullable(),
		loadTime: LoadTimeMetricsSchema,
		endpoints: z.array(ApiEndpointMetricSchema),
		networkFailures: z.array(NetworkFailureCountSchema),
		networkFailureTotal: NonNegativeInt,
		/** The performance-test runs recorded for the range, newest first. */
		performanceTests: z.array(PerformanceTestResultSchema),
	})
	.strict()

export const TechnicalMetricsRangeInputSchema = EngagementRangeInputSchema

export type CrashMetrics = z.infer<typeof CrashMetricsSchema>
export type LoadTimeMetrics = z.infer<typeof LoadTimeMetricsSchema>
export type ApiEndpointMetricView = z.infer<typeof ApiEndpointMetricSchema>
export type NetworkFailureCount = z.infer<typeof NetworkFailureCountSchema>
export type PerformanceTestResultView = z.infer<typeof PerformanceTestResultSchema>
export type RecordPerformanceTestInput = z.infer<typeof RecordPerformanceTestInputSchema>
export type ImportMonitoringMetricsInput = z.infer<typeof ImportMonitoringMetricsInputSchema>
export type TechnicalMetricsSummary = z.infer<typeof TechnicalMetricsSummarySchema>
