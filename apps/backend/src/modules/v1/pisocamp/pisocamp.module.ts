import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"

import { RbacModule } from "@/common/rbac/rbac.module"
import { ConsentGuard } from "@/shared/guards/consent.guard"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import { AnalyticsModule } from "./analytics/analytics.module"
import { AssetsModule } from "./assets/assets.module"
import { BundleModule } from "./bundle/bundle.module"
import { ContentModule } from "./content/content.module"
import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { PisoCampConsentSubjectService } from "./pisocamp-consent-subject.service"
import {
	pisoCampConsentDatabaseProvider,
	PisoCampConsentService,
	pisoCampConsentTransactionProvider,
} from "./pisocamp-consent.service"
import { PisoCampProfileController } from "./pisocamp-profile.controller"
import {
	pisoCampProfileDatabaseProvider,
	PisoCampProfileService,
	pisoCampProfileTransactionProvider,
} from "./pisocamp-profile.service"
import { PisoCampController } from "./pisocamp.controller"
import { PisoCampService } from "./pisocamp.service"

@Module({
	imports: [RbacModule, AnalyticsModule, AssetsModule, ContentModule, BundleModule],
	controllers: [PisoCampController, PisoCampProfileController],
	providers: [
		PisoCampAdminConfigService,
		PisoCampConsentService,
		PisoCampConsentSubjectService,
		PisoCampService,
		PisoCampProfileService,
		pisoCampProfileDatabaseProvider,
		pisoCampProfileTransactionProvider,
		IdempotencyService,
		IdempotencyInterceptor,
		pisoCampConsentDatabaseProvider,
		pisoCampConsentTransactionProvider,
		{ provide: APP_GUARD, useClass: ConsentGuard },
	],
})
export class PisoCampModule {}
