import { describe, expect, it } from "vitest"

import { PisoCampPublicConfigSchema } from "./pisocamp.schema.js"
import {
	PisoCampSurveyTriggerConfigSchema,
	SURVEY_TRIGGER_PRIORITY,
	SURVEY_TRIGGER_TYPES,
	UpsertPisoCampSurveyTriggerInputSchema,
} from "./survey-trigger.schema.js"

const base = {
	requestId: "7c1f9a2e-3b4d-4e5f-8a6b-9c0d1e2f3a4b",
	contentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
	triggerType: "topic_completion" as const,
	pageDepth: null,
	frequencyCapDays: 30,
	priority: 10,
	enabled: true,
}

describe("survey trigger rules", () => {
	it("names the five triggers Annex H states, and 1 as the highest priority", () => {
		expect([...SURVEY_TRIGGER_TYPES]).toEqual([
			"page_depth",
			"activity_completion",
			"topic_completion",
			"module_exit",
			"app_exit",
		])
		expect(SURVEY_TRIGGER_PRIORITY).toEqual({ highest: 1, lowest: 100 })
	})

	it("takes a rule with a cap and a priority", () => {
		expect(UpsertPisoCampSurveyTriggerInputSchema.safeParse(base).success).toBe(true)
		// No cap is a rule that fires every time, not a rule with a cap of zero.
		expect(
			UpsertPisoCampSurveyTriggerInputSchema.safeParse({
				...base,
				frequencyCapDays: null,
			}).success
		).toBe(true)
	})

	it("pairs a depth with the trigger that uses one, and only that trigger", () => {
		expect(
			UpsertPisoCampSurveyTriggerInputSchema.safeParse({
				...base,
				triggerType: "page_depth",
				pageDepth: 5,
			}).success
		).toBe(true)
		expect(
			UpsertPisoCampSurveyTriggerInputSchema.safeParse({
				...base,
				triggerType: "page_depth",
			}).success
		).toBe(false)
		expect(
			UpsertPisoCampSurveyTriggerInputSchema.safeParse({ ...base, pageDepth: 5 }).success
		).toBe(false)
	})

	it.each([
		["an unknown trigger", { triggerType: "on_a_whim" }],
		["a priority of zero", { priority: 0 }],
		["a priority past a hundred", { priority: 101 }],
		["a fractional priority", { priority: 1.5 }],
		["a cap of zero days", { frequencyCapDays: 0 }],
		["a cap over a year", { frequencyCapDays: 400 }],
		["a depth of zero", { triggerType: "page_depth", pageDepth: 0 }],
		["a depth past fifty", { triggerType: "page_depth", pageDepth: 51 }],
		["a survey that is not an id", { contentItemId: "the survey" }],
		["an unknown field", { surveyTitle: "How did we do?" }],
	])("refuses %s", (_label, patch) => {
		expect(
			UpsertPisoCampSurveyTriggerInputSchema.safeParse({ ...base, ...patch }).success
		).toBe(false)
	})

	it("carries the rules to a device in the public configuration", () => {
		const config = {
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
			exit_advisory_interval_hours: 24,
			survey_triggers: [
				{
					contentItemId: base.contentItemId,
					triggerType: "topic_completion",
					pageDepth: null,
					frequencyCapDays: 30,
					priority: 10,
				},
			],
		}

		expect(PisoCampPublicConfigSchema.safeParse(config).success).toBe(true)
		// Nothing about who arranged it: a device needs to know when to ask and
		// which survey wins, and nothing else.
		expect(
			PisoCampSurveyTriggerConfigSchema.safeParse({
				...config.survey_triggers[0],
				surveyTitle: "How did we do?",
			}).success
		).toBe(false)
	})

	it("still refuses a public config with no trigger list at all", () => {
		expect(
			PisoCampPublicConfigSchema.safeParse({
				module_enabled: true,
				account_prompt_enabled: true,
				config_version: "seed-1",
				exit_advisory_interval_hours: 24,
			}).success
		).toBe(false)
	})
})
