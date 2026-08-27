import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import { Logger } from "nestjs-pino"

import { v1 } from "@/config/api-versions.config"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ContentWorkflowService } from "./content-workflow.service"
import { ContentService } from "./content.service"

@Controller()
export class ContentController {
	constructor(
		private readonly contentService: ContentService,
		private readonly contentWorkflowService: ContentWorkflowService,
		private readonly logger: Logger
	) {}

	@RequirePermissions("content.items.edit")
	@Implement(v1.pisocamp.admin.content.list)
	async listContent() {
		return implement(v1.pisocamp.admin.content.list).handler(({ input }) =>
			this.safe("list", () => this.contentService.list(input))
		)
	}

	@RequirePermissions("content.items.approve")
	@Implement(v1.pisocamp.admin.content.reviewQueue)
	async reviewQueue() {
		return implement(v1.pisocamp.admin.content.reviewQueue).handler(({ input }) =>
			this.safe("reviewQueue", () => this.contentWorkflowService.listReviewQueue(input))
		)
	}

	@RequirePermissions("content.items.edit")
	@Implement(v1.pisocamp.admin.content.get)
	async getContent() {
		return implement(v1.pisocamp.admin.content.get).handler(({ input }) =>
			this.safe("get", () => this.contentService.get(input.itemId))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.edit")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.create)
	async createContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.create).handler(({ input }) =>
			this.safe("create", () => this.contentService.create(input, session.user.id))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.edit")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.update)
	async updateContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.update).handler(({ input }) =>
			this.safe("update", () => this.contentService.update(input, session.user.id))
		)
	}

	@RequirePermissions("content.items.approve")
	@Implement(v1.pisocamp.admin.content.review)
	async reviewContent() {
		return implement(v1.pisocamp.admin.content.review).handler(({ input }) =>
			this.safe("review", () => this.contentWorkflowService.getReviewDetail(input.itemId))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.submit")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.submit)
	async submitContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.submit).handler(({ input }) =>
			this.safe("submit", () =>
				this.contentWorkflowService.transition("submit", input, session.user.id)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.approve")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.approve)
	async approveContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.approve).handler(({ input }) =>
			this.safe("approve", () =>
				this.contentWorkflowService.transition("approve", input, session.user.id)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.approve")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.reject)
	async rejectContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.reject).handler(({ input }) =>
			this.safe("reject", () =>
				this.contentWorkflowService.transition("reject", input, session.user.id)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.publish")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.publish)
	async publishContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.publish).handler(({ input }) =>
			this.safe("publish", () =>
				this.contentWorkflowService.transition("publish", input, session.user.id)
			)
		)
	}

	private async safe<T>(operation: string, work: () => Promise<T>): Promise<T> {
		try {
			return await work()
		} catch (error) {
			if (error instanceof ORPCError) throw error
			this.logger.error({ operation, err: error }, "Unexpected content operation failure")
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Content operation failed" })
		}
	}
}
