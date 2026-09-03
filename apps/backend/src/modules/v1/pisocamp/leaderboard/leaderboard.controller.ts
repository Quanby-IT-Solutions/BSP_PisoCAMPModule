import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"

import { PisoCampLeaderboardService } from "./leaderboard.service"

/**
 * GM-4's board.
 *
 * Registered only, and that is the whole of the requirement: neither handler is
 * marked anonymous, so a guest never reaches them and the app shows the notice
 * explaining why instead.
 */
@Controller()
export class PisoCampLeaderboardController {
	constructor(private readonly leaderboard: PisoCampLeaderboardService) {}

	@Implement(v1.pisocamp.leaderboard.get)
	get(@Session() session: UserSession) {
		return implement(v1.pisocamp.leaderboard.get).handler(async ({ input }) =>
			this.leaderboard.forAccount(session.user.id, input.period)
		)
	}

	@Implement(v1.pisocamp.leaderboard.setAlias)
	setAlias(@Session() session: UserSession) {
		return implement(v1.pisocamp.leaderboard.setAlias).handler(async ({ input }) =>
			this.leaderboard.setAlias(session.user.id, input.alias)
		)
	}
}
