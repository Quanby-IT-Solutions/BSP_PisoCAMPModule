import { oc } from "@orpc/contract"

import {
	ListPisoCampRolesOutputSchema,
	SetPisoCampUserRolesInputSchema,
	SetPisoCampUserRolesOutputSchema,
} from "./role.schema.js"

const tags = ["Piso CAMP Administration"]

export const pisoCampRoleContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/roles",
			summary: "List roles with the permission keys they carry",
			tags,
		})
		.output(ListPisoCampRolesOutputSchema),
	setUserRoles: oc
		.route({
			method: "PUT",
			path: "/admin/pisocamp/users/{userId}/roles",
			summary: "Set the complete set of roles an account holds",
			tags,
		})
		.input(SetPisoCampUserRolesInputSchema)
		.output(SetPisoCampUserRolesOutputSchema),
}
