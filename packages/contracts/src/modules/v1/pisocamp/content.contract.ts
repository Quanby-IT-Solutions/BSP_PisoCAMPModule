import { oc } from "@orpc/contract"

import {
	ListPisoCampContentAuditInputSchema,
	ListPisoCampContentAuditOutputSchema,
} from "./content-audit.schema.js"
import {
	ApprovePisoCampContentInputSchema,
	ArchivePisoCampContentInputSchema,
	CreatePisoCampContentInputSchema,
	DeactivatePisoCampContentInputSchema,
	ListPisoCampContentInputSchema,
	ListPisoCampContentOutputSchema,
	ListPisoCampContentReviewQueueInputSchema,
	ListPisoCampContentReviewQueueOutputSchema,
	PisoCampContentDetailSchema,
	PisoCampContentItemIdSchema,
	PisoCampContentReviewDetailSchema,
	PublishPisoCampContentInputSchema,
	RejectPisoCampContentInputSchema,
	SchedulePisoCampContentPublicationInputSchema,
	SubmitPisoCampContentInputSchema,
	UnpublishPisoCampContentInputSchema,
	UpdatePisoCampContentInputSchema,
} from "./content.schema.js"
import {
	ListPisoCampContentVersionsInputSchema,
	ListPisoCampContentVersionsOutputSchema,
	RestorePisoCampContentVersionInputSchema,
} from "./version-history.schema.js"

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
	unpublish: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/unpublish",
			summary: "Withdraw published Piso CAMP content from the next bundle",
			tags,
		})
		.input(UnpublishPisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	deactivate: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/deactivate",
			summary: "Deactivate Piso CAMP content so it is never presented again",
			tags,
		})
		.input(DeactivatePisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	archive: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/archive",
			summary: "Archive deactivated Piso CAMP content as retained read-only history",
			tags,
		})
		.input(ArchivePisoCampContentInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	schedule: oc
		.route({
			method: "PUT",
			path: "/admin/pisocamp/content/{itemId}/schedule",
			summary: "Set or clear the scheduled publication time for approved content",
			tags,
		})
		.input(SchedulePisoCampContentPublicationInputSchema)
		.output(PisoCampContentReviewDetailSchema),
	audit: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/audit",
			summary: "List the complete change and approval history of one content item",
			tags,
		})
		.input(ListPisoCampContentAuditInputSchema)
		.output(ListPisoCampContentAuditOutputSchema),
	versions: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/versions",
			summary: "List Piso CAMP content version history with field-level differences",
			tags,
		})
		.input(ListPisoCampContentVersionsInputSchema)
		.output(ListPisoCampContentVersionsOutputSchema),
	restore: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/versions/{versionNo}/restore",
			summary: "Restore a prior approved Piso CAMP content version",
			tags,
		})
		.input(RestorePisoCampContentVersionInputSchema)
		.output(PisoCampContentReviewDetailSchema),
}
