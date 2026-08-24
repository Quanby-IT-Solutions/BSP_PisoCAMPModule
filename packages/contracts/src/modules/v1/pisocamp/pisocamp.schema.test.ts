import { describe, expect, it } from "vitest"

import {
	PisoCampAdminConfigSchema,
	PisoCampPublicConfigSchema,
	UpdatePisoCampAdminConfigSchema,
} from "./pisocamp.schema.js"

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

	it("rejects admin fields from the anonymous F1 schema", () => {
		expect(() =>
			PisoCampPublicConfigSchema.parse({
				module_enabled: true,
				account_prompt_enabled: true,
				config_version: "seed-1",
				session_inactivity_minutes: 30,
			})
		).toThrow()
	})
})

describe("PisoCampAdminConfigSchema", () => {
	it.each([1, 30, 1440])("accepts session inactivity value %i", value => {
		expect(PisoCampAdminConfigSchema.parse({ session_inactivity_minutes: value })).toEqual({
			session_inactivity_minutes: value,
		})
	})

	it.each([0, 1441, 1.5])("rejects invalid session inactivity value %s", value => {
		expect(() => PisoCampAdminConfigSchema.parse({ session_inactivity_minutes: value })).toThrow()
	})

	it("defaults the stored configuration to 30 minutes", () => {
		expect(PisoCampAdminConfigSchema.parse({})).toEqual({ session_inactivity_minutes: 30 })
	})

	it("requires the update key and rejects unknown keys", () => {
		expect(() => UpdatePisoCampAdminConfigSchema.parse({})).toThrow()
		expect(() =>
			UpdatePisoCampAdminConfigSchema.parse({
				session_inactivity_minutes: 30,
				unexpected: true,
			})
		).toThrow()
	})
})
