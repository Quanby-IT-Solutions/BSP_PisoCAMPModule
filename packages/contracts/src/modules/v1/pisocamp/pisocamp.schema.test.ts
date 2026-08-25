import { describe, expect, it } from "vitest"

import {
	ConsentDecisionSchema,
	ConsentPurposeSchema,
	ConsentStateSchema,
	DevicePseudoIdSchema,
	GetPisoCampConsentInputSchema,
	PisoCampAdminConfigSchema,
	PisoCampConsentStatusSchema,
	PisoCampLocationCatalogSchema,
	PisoCampProfileOutputSchema,
	PisoCampProfileSchema,
	PisoCampPublicConfigSchema,
	RecordedPisoCampConsentSchema,
	RecordPisoCampConsentInputSchema,
	UpdatePisoCampAdminConfigSchema,
	UpsertPisoCampProfileInputSchema,
} from "./pisocamp.schema.js"

describe("Piso CAMP F3 profile schemas", () => {
	it("accepts only the frozen demographic fields", () => {
		expect(
			UpsertPisoCampProfileInputSchema.parse({
				id: "3f2504e0-4f89-4fd3-9a0c-0305e82c3301",
				gender: "prefer_not_to_say",
				age: 18,
				regionCode: "1300000000",
				cityCode: "1380600000",
			})
		).toMatchObject({ age: 18, gender: "prefer_not_to_say" })
		expect(() =>
			UpsertPisoCampProfileInputSchema.parse({
				id: crypto.randomUUID(),
				gender: "other",
				age: 0,
				regionCode: "13",
				cityCode: "1",
			})
		).toThrow()
	})

	it("composes Better Auth identity with completion state", () => {
		expect(PisoCampProfileSchema).toBe(PisoCampProfileOutputSchema)
		expect(
			PisoCampProfileOutputSchema.parse({
				status: "missing",
				missingFields: ["gender", "age", "regionCode", "cityCode"],
				name: "Test User",
				email: "test@example.com",
				profile: null,
			})
		).toBeDefined()
	})

	it.each([
		{
			label: "complete with missing fields",
			output: {
				status: "complete",
				missingFields: ["age"],
				name: "Test User",
				email: "test@example.com",
				profile: {
					gender: "prefer_not_to_say",
					age: 18,
					regionCode: "1300000000",
					cityCode: "1380600000",
					registrationConsentRecordId: "3f2504e0-4f89-4fd3-9a0c-0305e82c3301",
				},
			},
		},
		{
			label: "complete with a null profile",
			output: {
				status: "complete",
				missingFields: [],
				name: "Test User",
				email: "test@example.com",
				profile: null,
			},
		},
		{
			label: "missing with no missing fields",
			output: {
				status: "missing",
				missingFields: [],
				name: "Test User",
				email: "test@example.com",
				profile: null,
			},
		},
		{
			label: "missing with a populated profile",
			output: {
				status: "missing",
				missingFields: ["age"],
				name: "Test User",
				email: "test@example.com",
				profile: {
					gender: "prefer_not_to_say",
					age: 18,
					regionCode: "1300000000",
					cityCode: "1380600000",
					registrationConsentRecordId: "3f2504e0-4f89-4fd3-9a0c-0305e82c3301",
				},
			},
		},
	])("rejects a contradictory profile output: $label", ({ output }) => {
		expect(PisoCampProfileOutputSchema.safeParse(output).success).toBe(false)
	})

	it("keeps the public catalog strict and versioned", () => {
		expect(
			PisoCampLocationCatalogSchema.parse({
				version: "PSGC-2Q-2026",
				sourceUrl: "https://psa.gov.ph/classification/psgc/summary",
				catalogSha256: "a".repeat(64),
				regions: [],
			})
		).toBeDefined()
	})
})

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
