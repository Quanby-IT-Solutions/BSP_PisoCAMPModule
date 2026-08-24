import { Module } from "@nestjs/common"

import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { PisoCampController } from "./pisocamp.controller"
import { PisoCampService } from "./pisocamp.service"

@Module({
	controllers: [PisoCampController],
	providers: [PisoCampAdminConfigService, PisoCampService, IdempotencyInterceptor],
})
export class PisoCampModule {}
