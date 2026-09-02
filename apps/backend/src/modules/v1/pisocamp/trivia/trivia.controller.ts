import { Controller, HttpException } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { TriviaService } from "./trivia.service"

@Controller()
export class TriviaController {
	constructor(private readonly triviaService: TriviaService) {}

	/**
	 * Sync is for a registered account, so there is no anonymous branch: a
	 * guest's answers stay on their device until they register.
	 */
	@StrictThrottle()
	@Implement(v1.pisocamp.trivia.ingest)
	ingest(@Session() session: UserSession) {
		return implement(v1.pisocamp.trivia.ingest).handler(async ({ input }) => {
			try {
				return await this.triviaService.ingest(session.user.id, input)
			} catch (error) {
				this.rethrow(error)
			}
		})
	}

	private rethrow(error: unknown): never {
		if (error instanceof ORPCError) throw error
		if (!(error instanceof HttpException)) throw error
		const status = error.getStatus()
		const code = status === 401 ? "UNAUTHORIZED" : status === 409 ? "CONFLICT" : "BAD_REQUEST"
		throw new ORPCError(code, { message: error.message })
	}
}
