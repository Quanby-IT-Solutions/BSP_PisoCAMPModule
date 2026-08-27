import { oc } from "@orpc/contract"

import {
	ApprovePisoCampContentInputSchema,
	CreatePisoCampContentInputSchema,
	ListPisoCampContentInputSchema,
	ListPisoCampContentOutputSchema,
	ListPisoCampContentReviewQueueInputSchema,
	ListPisoCampContentReviewQueueOutputSchema,
	PisoCampContentDetailSchema,
	PisoCampContentItemIdSchema,
	PisoCampContentReviewDetailSchema,
	PublishPisoCampContentInputSchema,
	RejectPisoCampContentInputSchema,
	SubmitPisoCampContentInputSchema,
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
	reviewQueue: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/review-queue",
			summary: "List Piso CAMP content awaiting review or publication",
			tags,
		})
		.input(ListPisoCampContentReviewQueueInputSchema)
		.output(ListPisoCampContentReviewQueueOutputSchema),
	review: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/review",
			summary: "Get immutable Piso CAMP content workflow details",
			tags,
		})
		.input(PisoCampContentItemIdSchema)
		.output(PisoCampContentReviewDetailSchema),
	submit: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/submit",
			summary: "Submit draft Piso CAMP content for review",
			tags,
		})
		.input(SubmitPisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	approve: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/approve",
			summary: "Approve submitted Piso CAMP content",
			tags,
		})
		.input(ApprovePisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	reject: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/reject",
			summary: "Reject submitted Piso CAMP content",
			tags,
		})
		.input(RejectPisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	publish: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/publish",
			summary: "Publish approved Piso CAMP content",
			tags,
		})
		.input(PublishPisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
}
