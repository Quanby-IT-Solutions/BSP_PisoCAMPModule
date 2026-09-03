import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { NotificationsController, PushController } from "./push.controller"
import { PushDispatcherService } from "./push-dispatcher.service"
import { PushService } from "./push.service"

@Module({
	imports: [AuditModule],
	controllers: [PushController, NotificationsController],
	providers: [PushService, PushDispatcherService],
	exports: [PushService],
})
export class PisoCampPushModule {}
