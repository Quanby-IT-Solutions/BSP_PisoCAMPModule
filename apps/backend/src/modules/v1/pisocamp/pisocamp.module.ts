import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"

import { RbacModule } from "@/common/rbac/rbac.module"
import { ConsentGuard } from "@/shared/guards/consent.guard"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import { PisoCampAccountsModule } from "./accounts/accounts.module"
import { AnalyticsModule } from "./analytics/analytics.module"
import { PisoCampAuditViewerModule } from "./audit/audit-viewer.module"
import { PisoCampDataSubjectModule } from "./data-subject/data-subject.module"
import { PisoCampLeaderboardModule } from "./leaderboard/leaderboard.module"
import { PisoCampProgressModule } from "./progress/progress.module"
import { PisoCampPushModule } from "./push/push.module"
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
import { PreviewModule } from "./preview/preview.module"
import { ReportsModule } from "./reports/reports.module"
import { SurveysModule } from "./surveys/surveys.module"
import { TriviaModule } from "./trivia/trivia.module"

@Module({
	imports: [
		RbacModule,
		AnalyticsModule,
		AssetsModule,
		ContentModule,
		PreviewModule,
		BundleModule,
		TriviaModule,
		SurveysModule,
		ReportsModule,
		PisoCampAccountsModule,
		PisoCampAuditViewerModule,
		PisoCampDataSubjectModule,
		PisoCampLeaderboardModule,
		PisoCampProgressModule,
		PisoCampPushModule,
	],
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
