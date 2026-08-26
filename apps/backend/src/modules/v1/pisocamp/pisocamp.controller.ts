import { Controller, HttpException, Req, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import {
	PisoCampConsentSubjectService,
	type ConsentHttpRequest,
} from "./pisocamp-consent-subject.service"
import { PisoCampConsentService } from "./pisocamp-consent.service"
import { PisoCampService } from "./pisocamp.service"

@Controller()
export class PisoCampController {
	constructor(
		private readonly pisoCampService: PisoCampService,
		private readonly adminConfigService: PisoCampAdminConfigService,
		private readonly consentService: PisoCampConsentService,
		private readonly consentSubjectService: PisoCampConsentSubjectService
	) {}

	@RequirePermissions("admin.config.manage")
	@Implement(v1.pisocamp.admin.config.get)
	async getAdminConfig() {
		return implement(v1.pisocamp.admin.config.get).handler(async () => {
			return this.adminConfigService.get()
		})
	}

	@StrictThrottle()
	@RequirePermissions("admin.config.manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.config.update)
	async updateAdminConfig(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.config.update).handler(async ({ input }) => {
			return this.adminConfigService.update({
				actorId: session.user.id,
				...input,
			})
		})
	}

	@AllowAnonymous()
	@Implement(v1.pisocamp.config.get)
	async getPublicConfig() {
		return implement(v1.pisocamp.config.get).handler(async () => {
			return this.pisoCampService.getPublicConfig()
		})
	}

	@AllowAnonymous()
	@Implement(v1.pisocamp.consent.get)
	async getConsent(@Req() request: ConsentHttpRequest) {
		return implement(v1.pisocamp.consent.get).handler(async ({ input }) => {
			try {
				const subject = await this.consentSubjectService.resolve(request)
				return await this.consentService.getStatus(subject, input.purpose)
			} catch (error) {
				this.rethrowConsentError(error)
			}
		})
	}

	@AllowAnonymous()
	@StrictThrottle()
	@RequireIdempotency({ requestIdField: "id", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.consent.record)
	async recordConsent(@Req() request: ConsentHttpRequest) {
		return implement(v1.pisocamp.consent.record).handler(async ({ input }) => {
			try {
				const subject = await this.consentSubjectService.resolve(request)
				return await this.consentService.record(subject, input)
			} catch (error) {
				this.rethrowConsentError(error)
			}
		})
	}

	/** Nest exceptions thrown inside an oRPC handler otherwise surface as an incorrect 500. */
	private rethrowConsentError(error: unknown): never {
		if (error instanceof ORPCError) throw error
		if (!(error instanceof HttpException)) throw error

		const code =
			error.getStatus() === 400
				? "BAD_REQUEST"
				: error.getStatus() === 401
					? "UNAUTHORIZED"
					: error.getStatus() === 409
						? "CONFLICT"
						: error.getStatus() === 503
							? "SERVICE_UNAVAILABLE"
							: "INTERNAL_SERVER_ERROR"

		throw new ORPCError(code, { message: error.message })
	}
}
