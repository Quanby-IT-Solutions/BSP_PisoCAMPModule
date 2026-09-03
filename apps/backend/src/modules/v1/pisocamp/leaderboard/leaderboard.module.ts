import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"
import { PisoCampLeaderboardController } from "./leaderboard.controller"
import { PisoCampLeaderboardService } from "./leaderboard.service"

@Module({
	imports: [AuditModule],
	controllers: [PisoCampLeaderboardController],
	providers: [PisoCampLeaderboardService, PisoCampAdminConfigService],
	exports: [PisoCampLeaderboardService],
})
export class PisoCampLeaderboardModule {}
