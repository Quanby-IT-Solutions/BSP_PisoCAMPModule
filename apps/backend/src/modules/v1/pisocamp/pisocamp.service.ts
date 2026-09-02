import { Injectable } from "@nestjs/common"

import type { V1Outputs } from "@/config/contract-types"

import { SurveyTriggerService } from "./surveys/survey-trigger.service"

const staticConfig = Object.freeze({
	module_enabled: true,
	account_prompt_enabled: true,
	config_version: "seed-1",
})

@Injectable()
export class PisoCampService {
	constructor(private readonly triggers: SurveyTriggerService) {}

	/**
	 * The configuration a device reads without a session.
	 *
	 * EV-3's rules are part of it because a device has to know when to ask and
	 * which survey wins, and neither fact names anybody.
	 */
	async getPublicConfig(): Promise<V1Outputs["pisocamp"]["config"]["get"]> {
		return { ...staticConfig, survey_triggers: await this.triggers.publicRules() }
	}
}
