import { oc } from "@orpc/contract"

import {
	IngestAnalyticsEventsInputSchema,
	IngestAnalyticsEventsOutputSchema,
	ModuleEntryTodaySchema,
} from "./analytics.schema.js"
import { AdoptionRangeInputSchema, AdoptionSummarySchema } from "./adoption.schema.js"
import {
	EngagementRangeInputSchema,
	EngagementSummarySchema,
} from "./engagement.schema.js"
import { RetentionRangeInputSchema, RetentionSummarySchema } from "./retention.schema.js"
import {
	GamificationRangeInputSchema,
	GamificationSummarySchema,
} from "./gamification.schema.js"
import {
	SurveyMetricsRangeInputSchema,
	SurveyMetricsSummarySchema,
} from "./survey-metrics.schema.js"
import {
	ImportMonitoringMetricsInputSchema,
	ImportMonitoringMetricsOutputSchema,
	PerformanceTestResultSchema,
	RecordPerformanceTestInputSchema,
	TechnicalMetricsRangeInputSchema,
	TechnicalMetricsSummarySchema,
} from "./technical.schema.js"

export const pisoCampAnalyticsContract = {
	events: {
		ingest: oc
			.route({
				method: "POST",
				path: "/pisocamp/events",
				summary: "Ingest idempotent Piso CAMP analytics events",
				tags: ["Piso CAMP Analytics"],
				spec: spec => ({ ...spec, security: [] }),
			})
			.input(IngestAnalyticsEventsInputSchema)
			.output(IngestAnalyticsEventsOutputSchema),
	},
	analytics: {
		moduleEntryToday: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/module-entry-today",
				summary: "Count today's Piso CAMP module entries",
				tags: ["Piso CAMP Analytics"],
			})
			.output(ModuleEntryTodaySchema),
		engagement: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/engagement",
				summary: "Engagement KPIs for a range of Asia/Manila days",
				tags: ["Piso CAMP Analytics"],
			})
			.input(EngagementRangeInputSchema)
			.output(EngagementSummarySchema),
		adoption: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/adoption",
				summary: "Feature usage and onboarding KPIs for a range of days",
				tags: ["Piso CAMP Analytics"],
			})
			.input(AdoptionRangeInputSchema)
			.output(AdoptionSummarySchema),
		retention: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/retention",
				summary: "Retention cohorts, churn and lifetime for a range of days",
				tags: ["Piso CAMP Analytics"],
			})
			.input(RetentionRangeInputSchema)
			.output(RetentionSummarySchema),
		gamification: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/gamification",
				summary: "Leaderboard, trivia and learning re-engagement KPIs",
				tags: ["Piso CAMP Analytics"],
			})
			.input(GamificationRangeInputSchema)
			.output(GamificationSummarySchema),
		surveys: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/surveys",
				summary: "Survey results, ratings, NPS and consent status",
				tags: ["Piso CAMP Analytics"],
			})
			.input(SurveyMetricsRangeInputSchema)
			.output(SurveyMetricsSummarySchema),
		technical: oc
			.route({
				method: "GET",
				path: "/admin/pisocamp/analytics/technical",
				summary: "Crash, load-time, API and network health for a range of days",
				tags: ["Piso CAMP Analytics"],
			})
			.input(TechnicalMetricsRangeInputSchema)
			.output(TechnicalMetricsSummarySchema),
	},
	monitoring: {
		import: oc
			.route({
				method: "POST",
				path: "/admin/pisocamp/monitoring/metrics",
				summary: "Import a period of crash and API metrics from the monitoring tool",
				tags: ["Piso CAMP Analytics"],
			})
			.input(ImportMonitoringMetricsInputSchema)
			.output(ImportMonitoringMetricsOutputSchema),
		recordPerformanceTest: oc
			.route({
				method: "POST",
				path: "/admin/pisocamp/monitoring/performance-tests",
				summary: "Record the results of a performance test run",
				tags: ["Piso CAMP Analytics"],
			})
			.input(RecordPerformanceTestInputSchema)
			.output(PerformanceTestResultSchema),
	},
}
