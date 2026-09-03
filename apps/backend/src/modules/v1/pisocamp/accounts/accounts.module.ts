import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"
import { RbacModule } from "@/common/rbac/rbac.module"
import { RbacAdminModule } from "@/modules/v1/rbac/rbac.module"

import { PisoCampAccountService } from "./account.service"
import { PisoCampAccountsController } from "./accounts.controller"
import { PisoCampRoleService } from "./role.service"

@Module({
	imports: [AuditModule, RbacModule, RbacAdminModule],
	controllers: [PisoCampAccountsController],
	providers: [PisoCampAccountService, PisoCampRoleService],
})
export class PisoCampAccountsModule {}
