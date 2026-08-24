import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common"

import { AccountAccessService } from "@/common/rbac/account-access.service"
import { isDevicePseudoId } from "@/shared/identity/device-pseudo-id"
import {
	resolveVerifiedAccountId,
	type VerifiedSessionRequest,
} from "@/shared/identity/verified-session"

import type { ConsentSubject } from "./pisocamp-consent.service"

export type ConsentHttpRequest = VerifiedSessionRequest

@Injectable()
export class PisoCampConsentSubjectService {
	constructor(private readonly accountAccessService: AccountAccessService) {}

	async resolve(request: ConsentHttpRequest): Promise<ConsentSubject> {
		const accountId = await resolveVerifiedAccountId(request)

		if (accountId) {
			if (!(await this.accountAccessService.isActive(accountId))) {
				throw new UnauthorizedException("Account is deactivated")
			}
			return { accountId }
		}

		const rawDevicePseudoId = request.headers["x-device-pseudo-id"]
		if (!isDevicePseudoId(rawDevicePseudoId)) {
			throw new BadRequestException("A valid X-Device-Pseudo-Id header is required")
		}
		return { devicePseudoId: rawDevicePseudoId }
	}
}
