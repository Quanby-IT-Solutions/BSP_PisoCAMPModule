import { oc } from "@orpc/contract"

import { PisoCampProgressSchema } from "./progress.schema.js"

export const pisoCampProgressContract = {
	get: oc
		.route({
			method: "GET",
			path: "/pisocamp/me/progress",
			summary: "The signed-in person's own learning progress",
			tags: ["Piso CAMP"],
		})
		.output(PisoCampProgressSchema),
}
