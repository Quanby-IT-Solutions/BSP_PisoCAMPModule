import { oc } from "@orpc/contract"

import { pisoCampContentContract } from "./content.contract.js"
import {
	GetPisoCampConsentInputSchema,
	PisoCampAdminConfigSchema,
	PisoCampConsentStatusSchema,
	PisoCampLocationCatalogSchema,
	PisoCampProfileSchema,
	PisoCampPublicConfigSchema,
	RecordedPisoCampConsentSchema,
	RecordPisoCampConsentInputSchema,
	UpdatePisoCampAdminConfigSchema,
	UpsertPisoCampProfileInputSchema,
} from "./pisocamp.schema.js"

export const pisoCampContract = {
	admin: {
		content: pisoCampContentContract,
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
	locations: {
		get: oc
			.route({
				method: "GET",
				path: "/pisocamp/locations",
				summary: "Get the frozen PSGC region and city options",
				tags: ["Piso CAMP"],
				spec: spec => ({ ...spec, security: [] }),
			})
			.output(PisoCampLocationCatalogSchema),
	},
	profile: {
		get: oc
			.route({
				method: "GET",
				path: "/pisocamp/profile",
				summary: "Get authenticated Piso CAMP profile completion",
				tags: ["Piso CAMP Profile"],
			})
			.output(PisoCampProfileSchema),
		upsert: oc
			.route({
				method: "POST",
				path: "/pisocamp/profile",
				summary: "Complete authenticated Piso CAMP profile",
				tags: ["Piso CAMP Profile"],
			})
			.input(UpsertPisoCampProfileInputSchema)
			.output(PisoCampProfileSchema),
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
