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
