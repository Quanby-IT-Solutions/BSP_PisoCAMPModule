import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import { RbacAdminService } from "./rbac-admin.service"
import { RbacController } from "./rbac.controller"

@Module({
	imports: [RbacModule],
	controllers: [RbacController],
	providers: [RbacAdminService, IdempotencyService, IdempotencyInterceptor],
	exports: [RbacAdminService],
})
export class RbacAdminModule {}
