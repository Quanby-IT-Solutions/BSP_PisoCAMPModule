import { oc } from "@orpc/contract"

import {
	AttachPisoCampAssetInputSchema,
	AttachPisoCampAssetOutputSchema,
	DeletePisoCampAssetInputSchema,
	DeletePisoCampAssetOutputSchema,
	DetachPisoCampAssetInputSchema,
	DetachPisoCampAssetOutputSchema,
	ListPisoCampAssetsOutputSchema,
	UploadPisoCampAssetInputSchema,
	UploadPisoCampAssetOutputSchema,
} from "./asset.schema.js"
import { PisoCampContentItemIdSchema } from "./content.schema.js"

const tags = ["Piso CAMP Content Assets"]

export const pisoCampAssetContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/assets",
			summary: "List current Piso CAMP content assets",
			tags,
		})
		.input(PisoCampContentItemIdSchema)
		.output(ListPisoCampAssetsOutputSchema),
	upload: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/assets",
			summary: "Upload and attach a Piso CAMP content asset",
			tags,
		})
		.input(UploadPisoCampAssetInputSchema)
		.output(UploadPisoCampAssetOutputSchema),
	attach: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/assets/{assetId}/attach",
			summary: "Attach an existing Piso CAMP content asset",
			tags,
		})
		.input(AttachPisoCampAssetInputSchema)
		.output(AttachPisoCampAssetOutputSchema),
	detach: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/assets/{assetId}/detach",
			summary: "Detach a Piso CAMP content asset",
			tags,
		})
		.input(DetachPisoCampAssetInputSchema)
		.output(DetachPisoCampAssetOutputSchema),
	delete: oc
		.route({
			method: "DELETE",
			path: "/admin/pisocamp/assets/{assetId}",
			summary: "Delete a Piso CAMP content asset",
			tags,
		})
		.input(DeletePisoCampAssetInputSchema)
		.output(DeletePisoCampAssetOutputSchema),
}
