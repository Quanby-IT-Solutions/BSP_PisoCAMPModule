import { oc } from "@orpc/contract"

import {
	ListRecognitionModelsOutputSchema,
	PublishRecognitionModelInputSchema,
	PublishRecognitionModelOutputSchema,
	UpdateRecognitionThresholdsInputSchema,
} from "./recognition.schema.js"

const tags = ["Piso CAMP Recognition Models"]

export const pisoCampRecognitionContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/recognition/models",
			summary: "List published recognition models",
			tags,
		})
		.output(ListRecognitionModelsOutputSchema),
	publish: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/recognition/models",
			summary: "Publish a recognition model with its class list and thresholds",
			tags,
		})
		.input(PublishRecognitionModelInputSchema)
		.output(PublishRecognitionModelOutputSchema),
	updateThresholds: oc
		.route({
			method: "PUT",
			path: "/admin/pisocamp/recognition/models/{version}/thresholds",
			summary: "Update the confidence and dwell thresholds of a published model",
			tags,
		})
		.input(UpdateRecognitionThresholdsInputSchema)
		.output(PublishRecognitionModelOutputSchema),
}
