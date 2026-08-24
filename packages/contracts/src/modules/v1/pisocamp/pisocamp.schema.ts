import { z } from "zod"

/** The complete allowlist of configuration safe for unauthenticated clients. */
export const PisoCampPublicConfigSchema = z
	.object({
		module_enabled: z.boolean(),
		account_prompt_enabled: z.boolean(),
		config_version: z.string(),
	})
	.strict()

export type PisoCampPublicConfig = z.infer<typeof PisoCampPublicConfigSchema>

const SessionInactivityMinutesSchema = z.number().int().min(1).max(1440)

/** Complete administrator-visible Piso CAMP configuration. */
export const PisoCampAdminConfigSchema = z
	.object({
		session_inactivity_minutes: SessionInactivityMinutesSchema.default(30),
	})
	.strict()

/** Accepted payload for replacing administrator-managed configuration. */
export const UpdatePisoCampAdminConfigSchema = z
	.object({
		session_inactivity_minutes: SessionInactivityMinutesSchema,
	})
	.strict()

export type PisoCampAdminConfig = z.infer<typeof PisoCampAdminConfigSchema>
export type UpdatePisoCampAdminConfig = z.infer<typeof UpdatePisoCampAdminConfigSchema>
