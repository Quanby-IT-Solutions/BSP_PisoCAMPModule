import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"
import { Logger } from "nestjs-pino"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { PreviewService } from "./preview.service"

@Controller()
export class PreviewController {
	constructor(
		private readonly previewService: PreviewService,
		private readonly logger: Logger
	) {}

	@StrictThrottle()
	@RequirePermissions("content.items.preview")
	@Implement(v1.pisocamp.admin.preview.create)
	async createPreview(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.preview.create).handler(({ input }) =>
			this.safe("create", () => this.previewService.createGrant(input, session.user.id))
		)
	}

	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.pisocamp.preview.redeem)
	async redeemPreview() {
		return implement(v1.pisocamp.preview.redeem).handler(({ input }) =>
			this.safe("redeem", () => this.previewService.redeem(input.token))
		)
	}

	private async safe<T>(operation: string, work: () => Promise<T>): Promise<T> {
		try {
			return await work()
		} catch (error) {
			if (error instanceof ORPCError) throw error
			this.logger.error(
				{ operation, errorName: error instanceof Error ? error.name : "Unknown" },
				"Unexpected content preview failure"
			)
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Preview operation failed" })
		}
	}
}
