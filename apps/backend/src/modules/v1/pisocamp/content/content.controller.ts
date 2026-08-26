import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ContentService } from "./content.service"

@Controller()
export class ContentController {
	constructor(private readonly contentService: ContentService) {}

	@RequirePermissions("content.items.edit")
	@Implement(v1.pisocamp.admin.content.list)
	async listContent() {
		return implement(v1.pisocamp.admin.content.list).handler(({ input }) =>
			this.safe(() => this.contentService.list(input))
		)
	}

	@RequirePermissions("content.items.edit")
	@Implement(v1.pisocamp.admin.content.get)
	async getContent() {
		return implement(v1.pisocamp.admin.content.get).handler(({ input }) =>
			this.safe(() => this.contentService.get(input.itemId))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.edit")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.create)
	async createContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.create).handler(({ input }) =>
			this.safe(() => this.contentService.create(input, session.user.id))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.items.edit")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.content.update)
	async updateContent(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.content.update).handler(({ input }) =>
			this.safe(() => this.contentService.update(input, session.user.id))
		)
	}

	private async safe<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work()
		} catch (error) {
			if (error instanceof ORPCError) throw error
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Content operation failed" })
		}
	}
}
