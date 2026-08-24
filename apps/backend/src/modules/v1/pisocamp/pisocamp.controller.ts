import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"

import { PisoCampService } from "./pisocamp.service"

@Controller()
export class PisoCampController {
	constructor(private readonly pisoCampService: PisoCampService) {}

	@AllowAnonymous()
	@Implement(v1.pisocamp.config.get)
	async getPublicConfig() {
		return implement(v1.pisocamp.config.get).handler(async () => {
			return this.pisoCampService.getPublicConfig()
		})
	}
}
