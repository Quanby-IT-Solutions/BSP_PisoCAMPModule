import { oc } from "@orpc/contract"

import {
	IngestTriviaResponsesInputSchema,
	IngestTriviaResponsesOutputSchema,
} from "./trivia.schema.js"

export const pisoCampTriviaContract = {
	responses: {
		ingest: oc
			.route({
				method: "POST",
				path: "/pisocamp/trivia/responses",
				summary: "Upload a batch of trivia responses idempotently",
				tags: ["Piso CAMP Trivia"],
			})
			.input(IngestTriviaResponsesInputSchema)
			.output(IngestTriviaResponsesOutputSchema),
	},
}
