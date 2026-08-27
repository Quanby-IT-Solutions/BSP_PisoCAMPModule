import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ContentWorkflowService } from "./content-workflow.service"
import { ContentController } from "./content.controller"
import { ContentService } from "./content.service"

@Module({
	imports: [RbacModule],
	controllers: [ContentController],
	providers: [ContentService, ContentWorkflowService, IdempotencyInterceptor],
	exports: [ContentWorkflowService],
})
export class ContentModule {}
