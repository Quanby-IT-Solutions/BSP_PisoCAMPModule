import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ContentController } from "./content.controller"
import { ContentService } from "./content.service"

@Module({
	imports: [RbacModule],
	controllers: [ContentController],
	providers: [ContentService, IdempotencyInterceptor],
})
export class ContentModule {}
