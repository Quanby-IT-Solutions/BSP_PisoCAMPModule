import { oc } from "@orpc/contract"

import { PisoCampPublicConfigSchema } from "./pisocamp.schema.js"

export const pisoCampContract = {
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
