import { oc } from "@orpc/contract"

import {
	GetPisoCampContentPreviewInputSchema,
	PisoCampContentPreviewGrantSchema,
	PisoCampContentPreviewSchema,
	RedeemPisoCampContentPreviewInputSchema,
} from "./preview.schema.js"

const tags = ["Piso CAMP Content Preview"]

export const pisoCampContentPreviewContract = {
	create: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/versions/{versionNo}/preview",
			summary: "Generate a short-lived Piso CAMP content preview grant",
			tags,
		})
		.input(GetPisoCampContentPreviewInputSchema)
		.output(PisoCampContentPreviewGrantSchema),
}

export const pisoCampPreviewContract = {
	redeem: oc
		.route({
			method: "GET",
			path: "/pisocamp/preview",
			summary: "Redeem a signed Piso CAMP content preview grant",
			tags,
			// Token-authenticated, not session-authenticated: the mobile preview
			// build has no admin session, and the grant itself carries the actor,
			// version and expiry the server re-checks on every read.
			spec: spec => ({ ...spec, security: [] }),
		})
		.input(RedeemPisoCampContentPreviewInputSchema)
		.output(PisoCampContentPreviewSchema),
}
