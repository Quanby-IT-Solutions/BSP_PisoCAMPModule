import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { AccountAccessService } from "./account-access.service"
import { RbacCacheService } from "./rbac-cache.service"
import { RbacService } from "./rbac.service"

@Module({
	imports: [AuditModule],
	providers: [AccountAccessService, RbacCacheService, RbacService],
	exports: [AccountAccessService, RbacService, RbacCacheService],
})
export class RbacModule {}
