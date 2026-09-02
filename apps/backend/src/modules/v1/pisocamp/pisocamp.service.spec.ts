import type { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import type { SurveyTriggerService } from "./surveys/survey-trigger.service"
import { PisoCampService } from "./pisocamp.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const rule = {
	contentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
	triggerType: "topic_completion" as const,
	pageDepth: null,
	frequencyCapDays: 30,
	priority: 10,
}

function serviceWith(rules: (typeof rule)[], intervalHours = 24) {
	return new PisoCampService(
		{ publicRules: async () => rules } as unknown as SurveyTriggerService,
		{
			exitAdvisoryIntervalHours: async () => intervalHours,
		} as unknown as PisoCampAdminConfigService
	)
}

describe("PisoCampService", () => {
	it("returns only the safe public F1 defaults", async () => {
		await expect(serviceWith([]).getPublicConfig()).resolves.toEqual({
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
			survey_triggers: [],
			exit_advisory_interval_hours: 24,
		})
	})

	it("carries EV-4's advisory interval to the device", async () => {
		await expect(serviceWith([], 6).getPublicConfig()).resolves.toMatchObject({
			exit_advisory_interval_hours: 6,
		})
	})

	it("carries EV-3's trigger rules to the device", async () => {
		// A device with no session still needs to know when to ask and which
		// survey wins; neither fact names anybody.
		await expect(serviceWith([rule]).getPublicConfig()).resolves.toMatchObject({
			survey_triggers: [rule],
		})
	})
})
