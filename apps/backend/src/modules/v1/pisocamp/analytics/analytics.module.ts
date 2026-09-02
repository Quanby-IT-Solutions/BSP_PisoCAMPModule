import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { AnalyticsController } from "./analytics.controller"
import { analyticsDatabaseProvider, AnalyticsService } from "./analytics.service"
import { AdoptionService } from "./adoption.service"
import { EngagementService } from "./engagement.service"
import { SessionizerService } from "./sessionizer.service"

@Module({
	imports: [AuditModule],
	controllers: [AnalyticsController],
	providers: [
		AnalyticsService,
		analyticsDatabaseProvider,
		AdoptionService,
		EngagementService,
		SessionizerService,
		PisoCampAdminConfigService,
	],
	exports: [SessionizerService],
})
export class AnalyticsModule {}
