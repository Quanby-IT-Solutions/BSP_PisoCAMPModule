import { oc } from "@orpc/contract"

import {
	IngestAnalyticsEventsInputSchema,
	IngestAnalyticsEventsOutputSchema,
	ModuleEntryTodaySchema,
} from "./analytics.schema.js"

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
	},
}
