import { oc } from "@orpc/contract"

import {
	DataSubjectExportSchema,
	DeletePisoCampSubjectDataInputSchema,
	DeletePisoCampSubjectDataOutputSchema,
} from "./data-subject.schema.js"

export const pisoCampDataSubjectContract = {
	/** The signed-in person's own copy. No administrator is involved. */
	exportMine: oc
		.route({
			method: "GET",
			path: "/pisocamp/me/data-export",
			summary: "Export everything Piso CAMP holds about the signed-in person",
			tags: ["Piso CAMP"],
		})
		.output(DataSubjectExportSchema),
}

export const pisoCampAdminDataSubjectContract = {
	delete: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/accounts/{accountId}/data-deletion",
			summary: "Delete or pseudonymise a person's Piso CAMP data",
			tags: ["Piso CAMP Administration"],
		})
		.input(DeletePisoCampSubjectDataInputSchema)
		.output(DeletePisoCampSubjectDataOutputSchema),
}
