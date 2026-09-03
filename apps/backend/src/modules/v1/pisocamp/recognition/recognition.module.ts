import { Module } from "@nestjs/common"

import { AuditService } from "@/common/audit/audit.service"
import { RbacModule } from "@/common/rbac/rbac.module"

import { PostgresBundleObjectStore } from "../bundle/bundle-object-store"
import { RecognitionController } from "./recognition.controller"
import { RecognitionService } from "./recognition.service"

@Module({
	imports: [RbacModule],
	controllers: [RecognitionController],
	providers: [RecognitionService, PostgresBundleObjectStore, AuditService],
	exports: [RecognitionService],
})
export class RecognitionModule {}
