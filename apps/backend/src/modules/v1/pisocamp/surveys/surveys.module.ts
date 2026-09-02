import { Module } from "@nestjs/common"

import { RbacModule } from "@/common/rbac/rbac.module"

import { PisoCampConsentSubjectService } from "../pisocamp-consent-subject.service"
import { SurveyResponseService } from "./survey-response.service"
import { SurveysController } from "./surveys.controller"

@Module({
	imports: [RbacModule],
	controllers: [SurveysController],
	// The subject resolver is provided here rather than reached for across
	// modules: it is a small service over the request, and sharing an instance
	// buys nothing.
	providers: [SurveyResponseService, PisoCampConsentSubjectService],
})
export class SurveysModule {}
