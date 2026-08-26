import { oc } from "@orpc/contract"

import {
	CreatePisoCampContentInputSchema,
	ListPisoCampContentInputSchema,
	ListPisoCampContentOutputSchema,
	PisoCampContentDetailSchema,
	PisoCampContentItemIdSchema,
	UpdatePisoCampContentInputSchema,
} from "./content.schema.js"

const tags = ["Piso CAMP Content Administration"]

export const pisoCampContentContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content",
			summary: "List Piso CAMP content items",
			tags,
		})
		.input(ListPisoCampContentInputSchema)
		.output(ListPisoCampContentOutputSchema),
	get: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}",
			summary: "Get a Piso CAMP content item",
			tags,
		})
		.input(PisoCampContentItemIdSchema)
		.output(PisoCampContentDetailSchema),
	create: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content",
			summary: "Create a draft Piso CAMP content item",
			tags,
		})
		.input(CreatePisoCampContentInputSchema)
		.output(PisoCampContentDetailSchema),
	update: oc
		.route({
			method: "PUT",
			path: "/admin/pisocamp/content/{itemId}",
			summary: "Append an edited draft Piso CAMP content version",
			tags,
		})
		.input(UpdatePisoCampContentInputSchema)
		.output(PisoCampContentDetailSchema),
}
