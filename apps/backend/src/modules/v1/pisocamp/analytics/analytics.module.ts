import { Module } from "@nestjs/common"

import { AnalyticsController } from "./analytics.controller"
import { analyticsDatabaseProvider, AnalyticsService } from "./analytics.service"

@Module({
	controllers: [AnalyticsController],
	providers: [AnalyticsService, analyticsDatabaseProvider],
})
export class AnalyticsModule {}
