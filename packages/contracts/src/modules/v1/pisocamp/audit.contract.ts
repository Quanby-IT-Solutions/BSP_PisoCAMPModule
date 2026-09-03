import { oc } from "@orpc/contract"

import { ListAuditLogRequestSchema, ListAuditLogResponseSchema } from "../rbac/rbac.schema.js"

export const pisoCampAuditContract = {
	list: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/audit",
			summary: "Browse and filter administrative audit entries",
			tags: ["Piso CAMP Administration"],
		})
		.input(ListAuditLogRequestSchema)
		.output(ListAuditLogResponseSchema),
}
