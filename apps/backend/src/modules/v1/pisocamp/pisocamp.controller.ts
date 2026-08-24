import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { PisoCampService } from "./pisocamp.service"

@Controller()
export class PisoCampController {
	constructor(
		private readonly pisoCampService: PisoCampService,
		private readonly adminConfigService: PisoCampAdminConfigService
	) {}

	@RequirePermissions("admin.config.manage")
	@Implement(v1.pisocamp.admin.config.get)
	async getAdminConfig() {
		return implement(v1.pisocamp.admin.config.get).handler(async () => {
			return this.adminConfigService.get()
		})
	}

	@StrictThrottle()
	@RequirePermissions("admin.config.manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.config.update)
	async updateAdminConfig(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.config.update).handler(async ({ input }) => {
			return this.adminConfigService.update({
				actorId: session.user.id,
				...input,
			})
		})
	}

	@AllowAnonymous()
	@Implement(v1.pisocamp.config.get)
	async getPublicConfig() {
		return implement(v1.pisocamp.config.get).handler(async () => {
			return this.pisoCampService.getPublicConfig()
		})
	}
}
