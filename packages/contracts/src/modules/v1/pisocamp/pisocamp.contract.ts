import { oc } from "@orpc/contract"

import {
	GetPisoCampConsentInputSchema,
	PisoCampAdminConfigSchema,
	PisoCampConsentStatusSchema,
	PisoCampPublicConfigSchema,
	RecordedPisoCampConsentSchema,
	RecordPisoCampConsentInputSchema,
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
	consent: {
		get: oc
			.route({
				method: "GET",
				path: "/pisocamp/consent/{purpose}",
				summary: "Get the active privacy notice and current consent state",
				tags: ["Piso CAMP Consent"],
				spec: spec => ({ ...spec, security: [] }),
			})
			.input(GetPisoCampConsentInputSchema)
			.output(PisoCampConsentStatusSchema),
		record: oc
			.route({
				method: "POST",
				path: "/pisocamp/consent",
				summary: "Record an immutable privacy-notice decision",
				tags: ["Piso CAMP Consent"],
				spec: spec => ({ ...spec, security: [] }),
			})
			.input(RecordPisoCampConsentInputSchema)
			.output(RecordedPisoCampConsentSchema),
	},
}
