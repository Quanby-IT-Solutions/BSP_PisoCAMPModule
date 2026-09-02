import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { AnalyticsModule } from "../analytics/analytics.module"
import { ActivityService } from "./activity.service"
import { ReportService } from "./report.service"
import { ReportsController } from "./reports.controller"

@Module({
	imports: [AuditModule, AnalyticsModule],
	controllers: [ReportsController],
	providers: [ActivityService, ReportService],
})
export class ReportsModule {}
