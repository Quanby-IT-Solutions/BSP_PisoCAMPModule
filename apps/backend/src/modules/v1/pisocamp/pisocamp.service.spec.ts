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

function serviceWith(
	rules: (typeof rule)[],
	overrides: Record<string, unknown> = {}
) {
	return new PisoCampService(
		{ publicRules: async () => rules } as unknown as SurveyTriggerService,
		{
			get: async () => ({
				session_inactivity_minutes: 30,
				exit_advisory_interval_hours: 24,
				churn_inactivity_days: 30,
				trivia_repeat_days: 30,
				leaderboard_enabled: false,
				leaderboard_top_group_percent: 10,
				key_action_events: ["content_view"],
				age_group_buckets: [{ minAge: 0, maxAge: null }],
				suppression_minimum: 10,
				recognition_confidence_threshold: 0.8,
				active_privacy_notice_version: null,
				...overrides,
			}),
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
			leaderboard_enabled: false,
			trivia_repeat_days: 30,
			recognition_confidence_threshold: 0.8,
			active_privacy_notice_version: null,
		})
	})

	it("carries EV-4's advisory interval to the device", async () => {
		await expect(
			serviceWith([], { exit_advisory_interval_hours: 6 }).getPublicConfig()
		).resolves.toMatchObject({ exit_advisory_interval_hours: 6 })
	})

	it("carries SA-3's device-facing settings, and none of the rest", async () => {
		const config = await serviceWith([], {
			leaderboard_enabled: true,
			trivia_repeat_days: 14,
		}).getPublicConfig()

		expect(config).toMatchObject({ leaderboard_enabled: true, trivia_repeat_days: 14 })
		// The analytics settings are the server's business: a device has no use
		// for them and an unauthenticated response is no place to put them.
		expect(config).not.toHaveProperty("suppression_minimum")
		expect(config).not.toHaveProperty("key_action_events")
		expect(config).not.toHaveProperty("age_group_buckets")
		expect(config).not.toHaveProperty("churn_inactivity_days")
		expect(config).not.toHaveProperty("session_inactivity_minutes")
	})

	it("carries EV-3's trigger rules to the device", async () => {
		// A device with no session still needs to know when to ask and which
		// survey wins; neither fact names anybody.
		await expect(serviceWith([rule]).getPublicConfig()).resolves.toMatchObject({
			survey_triggers: [rule],
		})
	})
})
