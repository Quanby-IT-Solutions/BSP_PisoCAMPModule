import { describe, expect, it } from "vitest"

import {
	ConsentDecisionSchema,
	ConsentPurposeSchema,
	ConsentStateSchema,
	DevicePseudoIdSchema,
	GetPisoCampConsentInputSchema,
	PisoCampAdminConfigSchema,
	PisoCampConsentStatusSchema,
	PisoCampPublicConfigSchema,
	RecordedPisoCampConsentSchema,
	RecordPisoCampConsentInputSchema,
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

const notice = {
	id: "8fa2d0d6-fce7-44db-b384-bb59d34bf40a",
	version: "2024-12-26",
	title: "BSP Mobile App Privacy Notice",
	body: "TEST FIXTURE ONLY — not approved legal copy.",
	sourceUrl: "https://www.bsp.gov.ph/Pages/AboutTheBank/MobileAppPrivacyNotice.aspx",
	contentSha256: "a".repeat(64),
	effectiveAt: "2024-12-26T00:00:00.000Z",
} as const

describe("Piso CAMP consent schemas", () => {
	it("accepts only the frozen purpose, decision, and derived-state literals", () => {
		expect(
			["registration", "survey", "demographic_analytics"].map(value =>
				ConsentPurposeSchema.parse(value)
			)
		).toEqual(["registration", "survey", "demographic_analytics"])
		expect(["granted", "declined"].map(value => ConsentDecisionSchema.parse(value))).toEqual([
			"granted",
			"declined",
		])
		expect(
			["none", "granted", "declined", "withdrawn", "requires_reconsent"].map(value =>
				ConsentStateSchema.parse(value)
			)
		).toHaveLength(5)
		expect(() => ConsentDecisionSchema.parse("withdrawn")).toThrow()
	})

	it("accepts exactly the F1 22-character base64url guest identity", () => {
		expect(DevicePseudoIdSchema.parse("AbCdEfGhIjKlMnOpQrSt_-")).toBe("AbCdEfGhIjKlMnOpQrSt_-")
		for (const invalid of [
			"short",
			"AbCdEfGhIjKlMnOpQrSt_-=",
			"AbCdEfGhIjKlMnOpQrSt+/",
			"AbCdEfGhIjKlMnOpQrSt_\n",
		]) {
			expect(() => DevicePseudoIdSchema.parse(invalid)).toThrow()
		}
	})

	it("parses a strict consent status containing the active full notice", () => {
		expect(
			PisoCampConsentStatusSchema.parse({
				purpose: "registration",
				state: "requires_reconsent",
				notice,
			})
		).toEqual({ purpose: "registration", state: "requires_reconsent", notice })

		expect(() =>
			PisoCampConsentStatusSchema.parse({
				purpose: "registration",
				state: "none",
				notice,
				accountId: "must-never-leak",
			})
		).toThrow()
	})

	it("accepts a strict record request without a client-supplied account identity", () => {
		const input = {
			id: "bd7c903f-b547-4186-b5bd-292f91d2e4bb",
			purpose: "registration",
			noticeId: notice.id,
			noticeVersion: notice.version,
			decision: "granted",
			respondedAt: "2026-08-24T01:02:03.000Z",
		} as const

		expect(RecordPisoCampConsentInputSchema.parse(input)).toEqual(input)
		expect(() => RecordPisoCampConsentInputSchema.parse({ ...input, accountId: "spoof" })).toThrow()
		expect(() => RecordPisoCampConsentInputSchema.parse({ ...input, id: "not-a-uuid" })).toThrow()
	})

	it("returns immutable evidence plus the resulting state", () => {
		const output = {
			id: "bd7c903f-b547-4186-b5bd-292f91d2e4bb",
			purpose: "registration",
			noticeId: notice.id,
			noticeVersion: notice.version,
			decision: "declined",
			respondedAt: "2026-08-24T01:02:03.000Z",
			recordedAt: "2026-08-24T01:02:04.000Z",
			state: "declined",
		} as const

		expect(RecordedPisoCampConsentSchema.parse(output)).toEqual(output)
	})

	it("uses a strict path input for the status read", () => {
		expect(GetPisoCampConsentInputSchema.parse({ purpose: "survey" })).toEqual({
			purpose: "survey",
		})
		expect(() =>
			GetPisoCampConsentInputSchema.parse({ purpose: "survey", accountId: "spoof" })
		).toThrow()
	})
})
