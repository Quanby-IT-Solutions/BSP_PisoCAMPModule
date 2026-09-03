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
	 * those facts names anybody. SA-3 adds the rest of what a device acts on
	 * for itself, from the same administrator-managed registry.
	 */
	async getPublicConfig(): Promise<V1Outputs["pisocamp"]["config"]["get"]> {
		const config = await this.adminConfig.get()

		return {
			...staticConfig,
			survey_triggers: await this.triggers.publicRules(),
			exit_advisory_interval_hours: config.exit_advisory_interval_hours,
			leaderboard_enabled: config.leaderboard_enabled,
			trivia_repeat_days: config.trivia_repeat_days,
			recognition_confidence_threshold: config.recognition_confidence_threshold,
			active_privacy_notice_version: config.active_privacy_notice_version,
		}
	}
}
