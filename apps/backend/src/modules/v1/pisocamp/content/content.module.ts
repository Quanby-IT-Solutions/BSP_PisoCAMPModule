import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"
import { env } from "@/config/env.config"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import { ContentScheduleWorker } from "./content-schedule.worker"
import { ContentWorkflowService } from "./content-workflow.service"
import { ContentController } from "./content.controller"
import { ContentService } from "./content.service"

@Module({
	imports: [RbacModule],
	controllers: [ContentController],
	providers: [
		ContentService,
		ContentWorkflowService,
		IdempotencyService,
		IdempotencyInterceptor,
		{
			provide: ContentScheduleWorker,
			inject: [ContentWorkflowService],
			useFactory: (workflow: ContentWorkflowService) =>
				new ContentScheduleWorker(workflow, env.PISOCAMP_SCHEDULE_WORKER_ENABLED),
		},
	],
	exports: [ContentWorkflowService, ContentScheduleWorker],
})
export class ContentModule {}
