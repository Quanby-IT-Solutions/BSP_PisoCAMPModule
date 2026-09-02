import { oc } from "@orpc/contract"

import {
	IngestSurveyResponsesInputSchema,
	IngestSurveyResponsesOutputSchema,
} from "./survey-response.schema.js"

export const pisoCampSurveyContract = {
	responses: {
		ingest: oc
			.route({
				method: "POST",
				path: "/pisocamp/surveys/responses",
				summary: "Upload consented survey responses idempotently",
				tags: ["Piso CAMP Surveys"],
			})
			.input(IngestSurveyResponsesInputSchema)
			.output(IngestSurveyResponsesOutputSchema),
	},
}
