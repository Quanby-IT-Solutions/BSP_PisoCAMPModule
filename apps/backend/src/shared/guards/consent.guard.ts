import {
	Injectable,
	PreconditionFailedException,
	Scope,
	type CanActivate,
	type ExecutionContext,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"

import {
	PisoCampConsentSubjectService,
	type ConsentHttpRequest,
} from "@/modules/v1/pisocamp/pisocamp-consent-subject.service"
import { PisoCampConsentService } from "@/modules/v1/pisocamp/pisocamp-consent.service"
import {
	REQUIRED_CONSENT_KEY,
	type RequiredConsentPurpose,
} from "@/shared/decorators/require-consent.decorator"

@Injectable({ scope: Scope.REQUEST })
export class ConsentGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly subjectService: PisoCampConsentSubjectService,
		private readonly consentService: PisoCampConsentService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const purpose = this.reflector.getAllAndOverride<RequiredConsentPurpose>(REQUIRED_CONSENT_KEY, [
			context.getHandler(),
			context.getClass(),
		])
		if (!purpose) return true

		const request = context.switchToHttp().getRequest<ConsentHttpRequest>()
		const subject = await this.subjectService.resolve(request)
		const status = await this.consentService.getStatus(subject, purpose)
		if (status.state === "granted") return true

		throw new PreconditionFailedException({
			message: "Current consent required",
			state: status.state,
			purpose,
		})
	}
}
