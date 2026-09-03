import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { PisoCampDataSubjectService } from "./data-subject.service"

@Controller()
export class PisoCampDataSubjectController {
	constructor(private readonly dataSubject: PisoCampDataSubjectService) {}

	/**
	 * A person's own copy of their data.
	 *
	 * Signed in is the only requirement: it is their data, and a right you have
	 * to ask somebody else to exercise for you is a weaker right.
	 */
	@Implement(v1.pisocamp.me.exportMine)
	exportMine(@Session() session: UserSession) {
		return implement(v1.pisocamp.me.exportMine).handler(async () =>
			this.dataSubject.exportFor(session.user.id)
		)
	}

	@RequirePermissions("admin.accounts.manage")
	@Implement(v1.pisocamp.admin.dataSubject.delete)
	delete(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.dataSubject.delete).handler(async ({ input }) =>
			this.dataSubject.deleteFor({ ...input, actorId: session.user.id })
		)
	}
}
