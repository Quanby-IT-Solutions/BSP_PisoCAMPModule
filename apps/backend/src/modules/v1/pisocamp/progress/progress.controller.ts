import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"

import { PisoCampProgressService } from "./progress.service"

/**
 * GM-5's summary.
 *
 * Their own progress and nobody else's, so being signed in is the whole of the
 * requirement — a permission here would make somebody ask an administrator what
 * they themselves have done.
 */
@Controller()
export class PisoCampProgressController {
	constructor(private readonly progress: PisoCampProgressService) {}

	@Implement(v1.pisocamp.progress.get)
	get(@Session() session: UserSession) {
		return implement(v1.pisocamp.progress.get).handler(async () =>
			this.progress.forAccount(session.user.id)
		)
	}
}
