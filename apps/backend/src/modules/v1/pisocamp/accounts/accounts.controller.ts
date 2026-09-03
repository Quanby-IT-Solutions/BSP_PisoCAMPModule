import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { PisoCampAccountService } from "./account.service"

@Controller()
export class PisoCampAccountsController {
	constructor(private readonly accounts: PisoCampAccountService) {}

	@RequirePermissions("admin.accounts.manage")
	@Implement(v1.pisocamp.admin.accounts.list)
	list() {
		return implement(v1.pisocamp.admin.accounts.list).handler(async ({ input }) =>
			this.accounts.list(input)
		)
	}

	@RequirePermissions("admin.accounts.manage")
	@Implement(v1.pisocamp.admin.accounts.setStatus)
	setStatus(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.accounts.setStatus).handler(async ({ input }) =>
			this.accounts.setStatus({ ...input, actorId: session.user.id })
		)
	}
}
