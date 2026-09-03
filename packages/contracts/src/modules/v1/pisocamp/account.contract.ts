import { oc } from "@orpc/contract"

import {
	ListPisoCampAccountsInputSchema,
	ListPisoCampAccountsOutputSchema,
	PisoCampAccountSchema,
	SetPisoCampAccountStatusInputSchema,
} from "./account.schema.js"

const tags = ["Piso CAMP Administration"]

export const pisoCampAccountContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/accounts",
			summary: "List and search accounts with their status",
			tags,
		})
		.input(ListPisoCampAccountsInputSchema)
		.output(ListPisoCampAccountsOutputSchema),
	setStatus: oc
		.route({
			method: "PUT",
			path: "/admin/pisocamp/accounts/{accountId}/status",
			summary: "Activate or deactivate an account",
			tags,
		})
		.input(SetPisoCampAccountStatusInputSchema)
		.output(PisoCampAccountSchema),
}
