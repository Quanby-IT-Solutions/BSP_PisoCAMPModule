import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { AnalyticsModule } from "../analytics/analytics.module"
import { ActivityService } from "./activity.service"
import { ReportExportService } from "./report-export.service"
import { ReportService } from "./report.service"
import { ReportExportController, ReportsController } from "./reports.controller"

@Module({
	imports: [AuditModule, AnalyticsModule],
	controllers: [ReportsController, ReportExportController],
	providers: [ActivityService, ReportService, ReportExportService],
})
export class ReportsModule {}
