import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { PisoCampAccountService } from "./account.service"
import { PisoCampAccountsController } from "./accounts.controller"

@Module({
	imports: [AuditModule],
	controllers: [PisoCampAccountsController],
	providers: [PisoCampAccountService],
})
export class PisoCampAccountsModule {}
