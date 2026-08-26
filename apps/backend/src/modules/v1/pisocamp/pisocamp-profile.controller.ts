import { Controller, HttpException, Req, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { isDevicePseudoId } from "@/shared/identity/device-pseudo-id"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PisoCampProfileService } from "./pisocamp-profile.service"

type ProfileRequest = { headers: Record<string, string | string[] | undefined> }

@Controller()
export class PisoCampProfileController {
	constructor(private readonly profileService: PisoCampProfileService) {}

	@AllowAnonymous()
	@Implement(v1.pisocamp.locations.get)
	async getLocations() {
		return implement(v1.pisocamp.locations.get).handler(() => this.profileService.getLocations())
	}

	@Implement(v1.pisocamp.profile.get)
	async getProfile(@Session() session: UserSession) {
		return implement(v1.pisocamp.profile.get).handler(async () => {
			try {
				return await this.profileService.getProfile(session.user.id)
			} catch (error) {
				this.rethrow(error)
			}
		})
	}

	@StrictThrottle()
	@RequireIdempotency({ requestIdField: "id", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.profile.upsert)
	async completeProfile(@Session() session: UserSession, @Req() request: ProfileRequest) {
		return implement(v1.pisocamp.profile.upsert).handler(async ({ input }) => {
			try {
				const raw = request.headers["x-device-pseudo-id"]
				const devicePseudoId = Array.isArray(raw) ? raw[0] : raw
				if (!isDevicePseudoId(devicePseudoId))
					throw new ORPCError("BAD_REQUEST", {
						message: "A valid X-Device-Pseudo-Id header is required",
					})
				return await this.profileService.completeProfile(session.user.id, devicePseudoId, input)
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
			status === 400
				? "BAD_REQUEST"
				: status === 401
					? "UNAUTHORIZED"
					: status === 409
						? "CONFLICT"
						: status === 412
							? "PRECONDITION_FAILED"
							: status === 503
								? "SERVICE_UNAVAILABLE"
								: "INTERNAL_SERVER_ERROR"
		throw new ORPCError(code, { message: error.message })
	}
}
