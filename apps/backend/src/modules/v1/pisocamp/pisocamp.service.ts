import { Injectable } from "@nestjs/common"

import type { V1Outputs } from "@/config/contract-types"

const publicConfig: V1Outputs["pisocamp"]["config"]["get"] = Object.freeze({
	module_enabled: true,
	account_prompt_enabled: true,
	config_version: "seed-1",
})

@Injectable()
export class PisoCampService {
	async getPublicConfig(): Promise<V1Outputs["pisocamp"]["config"]["get"]> {
		return publicConfig
	}
}
