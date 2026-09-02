import { Injectable } from "@nestjs/common"

import type { V1Outputs } from "@/config/contract-types"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { SurveyTriggerService } from "./surveys/survey-trigger.service"

const staticConfig = Object.freeze({
	module_enabled: true,
	account_prompt_enabled: true,
	config_version: "seed-1",
})

@Injectable()
export class PisoCampService {
	constructor(
		private readonly triggers: SurveyTriggerService,
		private readonly adminConfig: PisoCampAdminConfigService
	) {}

	/**
	 * The configuration a device reads without a session.
	 *
	 * EV-3's rules and EV-4's advisory interval are part of it because a device
	 * decides when to ask and when to advise — offline included — and none of
	 * those facts names anybody.
	 */
	async getPublicConfig(): Promise<V1Outputs["pisocamp"]["config"]["get"]> {
		return {
			...staticConfig,
			survey_triggers: await this.triggers.publicRules(),
			exit_advisory_interval_hours: await this.adminConfig.exitAdvisoryIntervalHours(),
		}
	}
}
