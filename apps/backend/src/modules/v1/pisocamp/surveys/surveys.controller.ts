import { Controller, HttpException, Req } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import {
	PisoCampConsentSubjectService,
	type ConsentHttpRequest,
} from "@/modules/v1/pisocamp/pisocamp-consent-subject.service"
import { RequireConsent } from "@/shared/decorators/require-consent.decorator"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { SurveyResponseService } from "./survey-response.service"
import { SurveyTriggerService } from "./survey-trigger.service"

@Controller()
export class SurveysController {
	constructor(
		private readonly responses: SurveyResponseService,
		private readonly triggers: SurveyTriggerService,
		private readonly subjects: PisoCampConsentSubjectService
	) {}

	/**
	 * A guest may answer a survey, so there is no session requirement — but
	 * there is a consent requirement, and it is declared rather than
	 * hand-checked: the guard refuses the request before the handler runs if the
	 * subject holds no current grant for the survey purpose.
	 */
	@AllowAnonymous()
	@StrictThrottle()
	@RequireConsent("survey")
	@Implement(v1.pisocamp.surveys.ingest)
	ingest(@Req() request: ConsentHttpRequest) {
		return implement(v1.pisocamp.surveys.ingest).handler(async ({ input }) => {
			try {
				return await this.responses.ingest(await this.subjects.resolve(request), input)
			} catch (error) {
				this.rethrow(error)
			}
		})
	}

	@RequirePermissions("surveys.triggers.configure")
	@Implement(v1.pisocamp.admin.surveyTriggers.list)
	listTriggers() {
		return implement(v1.pisocamp.admin.surveyTriggers.list).handler(async () => {
			try {
				return await this.triggers.list()
			} catch (error) {
				this.rethrow(error)
			}
		})
	}

	@RequirePermissions("surveys.triggers.configure")
	@Implement(v1.pisocamp.admin.surveyTriggers.upsert)
	upsertTrigger(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.surveyTriggers.upsert).handler(async ({ input }) => {
			try {
				return await this.triggers.upsert({ ...input, actorId: session.user.id })
			} catch (error) {
				this.rethrow(error)
			}
		})
	}

	@RequirePermissions("surveys.triggers.configure")
	@Implement(v1.pisocamp.admin.surveyTriggers.remove)
	removeTrigger(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.surveyTriggers.remove).handler(async ({ input }) => {
			try {
				return await this.triggers.remove({ ...input, actorId: session.user.id })
			} catch (error) {
				this.rethrow(error)
			}
		})
	}

	private rethrow(error: unknown): never {
		if (error instanceof ORPCError) throw error
		if (!(error instanceof HttpException)) throw error
		const status = error.getStatus()
		const code =
			status === 404
				? "NOT_FOUND"
				: status === 400
					? "BAD_REQUEST"
				: status === 401
					? "UNAUTHORIZED"
					: status === 403
						? "FORBIDDEN"
						: status === 409
							? "CONFLICT"
							: status === 412
								? "PRECONDITION_FAILED"
								: "INTERNAL_SERVER_ERROR"
		throw new ORPCError(code, { message: error.message })
	}
}
