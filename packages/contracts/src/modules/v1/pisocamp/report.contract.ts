import { oc } from "@orpc/contract"

import {
	GenerateReportInputSchema,
	ListReportDefinitionsOutputSchema,
	ListReportRunsInputSchema,
	ListReportRunsOutputSchema,
	ReportRunSchema,
} from "./report.schema.js"

export const pisoCampReportContract = {
	definitions: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/reports/definitions",
			summary: "List the reports that can be generated",
			tags: ["Piso CAMP Reports"],
		})
		.output(ListReportDefinitionsOutputSchema),
	generate: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/reports/runs",
			summary: "Generate a historical report for a period and filters",
			tags: ["Piso CAMP Reports"],
		})
		.input(GenerateReportInputSchema)
		.output(ReportRunSchema),
	runs: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/reports/runs",
			summary: "List recently generated reports",
			tags: ["Piso CAMP Reports"],
		})
		.input(ListReportRunsInputSchema)
		.output(ListReportRunsOutputSchema),
}
