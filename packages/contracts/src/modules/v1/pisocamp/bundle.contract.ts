import { oc } from "@orpc/contract"
import { z } from "zod"

import { PisoCampBundleEnvelopeSchema } from "./bundle.schema.js"

const tags = ["Piso CAMP Bundle"]
const PisoCampBundleResourceInputSchema = z
	.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
	.strict()

export const pisoCampBundleContract = {
	manifest: {
		get: oc
			.route({
				method: "GET",
				path: "/pisocamp/bundle/manifest",
				summary: "Get the signed Piso CAMP bundle manifest envelope",
				tags,
				spec: spec => ({ ...spec, security: [] }),
			})
			.output(PisoCampBundleEnvelopeSchema),
	},
	resource: {
		get: oc
			.route({
				method: "GET",
				path: "/pisocamp/bundle/resources/{sha256}",
				summary: "Get an immutable Piso CAMP bundle resource by digest",
				tags,
				// A later Nest controller streams ranged raw bytes, so no JSON output schema applies here.
				spec: spec => ({
					...spec,
					security: [],
					responses: {
						...spec.responses,
						200: {
							description: "Immutable binary bundle resource",
							content: {
								"application/octet-stream": { schema: { type: "string", format: "binary" } },
							},
						},
					},
				}),
			})
			.input(PisoCampBundleResourceInputSchema),
	},
}
