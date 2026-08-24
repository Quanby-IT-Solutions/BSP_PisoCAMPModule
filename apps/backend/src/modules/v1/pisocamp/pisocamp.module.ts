import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"

import { RbacModule } from "@/common/rbac/rbac.module"
import { ConsentGuard } from "@/shared/guards/consent.guard"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { PisoCampConsentSubjectService } from "./pisocamp-consent-subject.service"
import {
	pisoCampConsentDatabaseProvider,
	PisoCampConsentService,
	pisoCampConsentTransactionProvider,
} from "./pisocamp-consent.service"
import { PisoCampController } from "./pisocamp.controller"
import { PisoCampService } from "./pisocamp.service"

@Module({
	imports: [RbacModule],
	controllers: [PisoCampController],
	providers: [
		PisoCampAdminConfigService,
		PisoCampConsentService,
		PisoCampConsentSubjectService,
		PisoCampService,
		IdempotencyInterceptor,
		pisoCampConsentDatabaseProvider,
		pisoCampConsentTransactionProvider,
		{ provide: APP_GUARD, useClass: ConsentGuard },
	],
})
export class PisoCampModule {}
