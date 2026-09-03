import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"

import { PisoCampDataSubjectController } from "./data-subject.controller"
import { PisoCampDataSubjectService } from "./data-subject.service"

@Module({
	imports: [AuditModule],
	controllers: [PisoCampDataSubjectController],
	providers: [PisoCampDataSubjectService],
})
export class PisoCampDataSubjectModule {}
