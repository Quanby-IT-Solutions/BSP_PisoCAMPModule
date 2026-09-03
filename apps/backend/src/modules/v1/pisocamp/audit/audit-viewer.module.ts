import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { PisoCampAuditViewerController } from "./audit-viewer.controller"

@Module({
	imports: [AuditModule],
	controllers: [PisoCampAuditViewerController],
})
export class PisoCampAuditViewerModule {}
