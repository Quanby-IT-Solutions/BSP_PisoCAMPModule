import { describe, expect, it } from "vitest"

import { PisoCampPublicConfigSchema } from "./pisocamp.schema.js"

describe("PisoCampPublicConfigSchema", () => {
	it("accepts the public F1 configuration", () => {
		expect(
			PisoCampPublicConfigSchema.parse({
				module_enabled: true,
				account_prompt_enabled: true,
				config_version: "seed-1",
			})
		).toEqual({
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
		})
	})

	it("rejects a non-public configuration key", () => {
		expect(() =>
			PisoCampPublicConfigSchema.parse({
				module_enabled: true,
				account_prompt_enabled: true,
				config_version: "seed-1",
				secret: "must-not-leak",
			})
		).toThrow()
	})
})
