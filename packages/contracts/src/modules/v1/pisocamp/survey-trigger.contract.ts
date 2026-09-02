import { oc } from "@orpc/contract"

import {
	DeletePisoCampSurveyTriggerInputSchema,
	DeletePisoCampSurveyTriggerOutputSchema,
	ListPisoCampSurveyTriggersOutputSchema,
	PisoCampSurveyTriggerRuleSchema,
	UpsertPisoCampSurveyTriggerInputSchema,
} from "./survey-trigger.schema.js"

export const pisoCampSurveyTriggerContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/surveys/triggers",
			summary: "List survey trigger rules",
			tags: ["Piso CAMP Administration"],
		})
		.output(ListPisoCampSurveyTriggersOutputSchema),
	upsert: oc
		.route({
			method: "PUT",
			path: "/admin/pisocamp/surveys/triggers",
			summary: "Create or replace one survey trigger rule",
			tags: ["Piso CAMP Administration"],
		})
		.input(UpsertPisoCampSurveyTriggerInputSchema)
		.output(PisoCampSurveyTriggerRuleSchema),
	remove: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/surveys/triggers/delete",
			summary: "Remove one survey trigger rule",
			tags: ["Piso CAMP Administration"],
		})
		.input(DeletePisoCampSurveyTriggerInputSchema)
		.output(DeletePisoCampSurveyTriggerOutputSchema),
}
