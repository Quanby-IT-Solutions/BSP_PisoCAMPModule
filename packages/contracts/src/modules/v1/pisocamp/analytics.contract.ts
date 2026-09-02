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
	},
}
