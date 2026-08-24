import { oc } from "@orpc/contract"

import {
	PisoCampAdminConfigSchema,
	PisoCampPublicConfigSchema,
	UpdatePisoCampAdminConfigSchema,
} from "./pisocamp.schema.js"

export const pisoCampContract = {
	admin: {
		config: {
			get: oc
				.route({
					method: "GET",
					path: "/admin/pisocamp/config",
					summary: "Get administrator-managed Piso CAMP configuration",
					tags: ["Piso CAMP Administration"],
				})
				.output(PisoCampAdminConfigSchema),
			update: oc
				.route({
					method: "PUT",
					path: "/admin/pisocamp/config",
					summary: "Update administrator-managed Piso CAMP configuration",
					tags: ["Piso CAMP Administration"],
				})
				.input(UpdatePisoCampAdminConfigSchema)
				.output(PisoCampAdminConfigSchema),
		},
	},
	config: {
		get: oc
			.route({
				method: "GET",
				path: "/pisocamp/config",
				summary: "Get public Piso CAMP configuration",
				tags: ["Piso CAMP"],
				spec: spec => ({ ...spec, security: [] }),
			})
			.output(PisoCampPublicConfigSchema),
	},
}
