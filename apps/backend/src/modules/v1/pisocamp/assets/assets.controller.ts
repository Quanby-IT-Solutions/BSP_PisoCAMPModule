import { Controller, Req, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Request } from "express"
import { Logger } from "nestjs-pino"

import { v1 } from "@/config/api-versions.config"
import { RequireIdempotency } from "@/shared/decorators/require-idempotency.decorator"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import {
	IdempotencyService,
	requireMatchingRequestId,
} from "@/shared/interceptors/idempotency.service"

import { AssetUploadInterceptor, getPreparedAssetUpload } from "./asset-upload.interceptor"
import { AssetsService } from "./assets.service"

export interface PreparedAssetRequest extends Request {
	headers: Request["headers"] & { "idempotency-key"?: string | string[] }
}

@Controller()
export class AssetsController {
	constructor(
		private readonly assetsService: AssetsService,
		private readonly idempotencyService: IdempotencyService,
		private readonly logger: Logger
	) {}

	@RequirePermissions("content.assets.upload")
	@Implement(v1.pisocamp.admin.assets.list)
	async list() {
		return implement(v1.pisocamp.admin.assets.list).handler(({ input }) =>
			this.safe("list", () => this.assetsService.list(input.itemId))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.assets.upload")
	@UseInterceptors(AssetUploadInterceptor)
	@Implement(v1.pisocamp.admin.assets.upload)
	async upload(@Session() session: UserSession, @Req() request: PreparedAssetRequest) {
		return implement(v1.pisocamp.admin.assets.upload).handler(({ input }) =>
			this.assetUploadWithIdempotency(session.user.id, request, input)
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.assets.upload")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.assets.attach)
	async attach(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.assets.attach).handler(({ input }) =>
			this.safe("attach", () => this.assetsService.attach(input, session.user.id))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.assets.upload")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.assets.detach)
	async detach(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.assets.detach).handler(({ input }) =>
			this.safe("detach", () => this.assetsService.detach(input, session.user.id))
		)
	}

	@StrictThrottle()
	@RequirePermissions("content.assets.upload")
	@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.pisocamp.admin.assets.delete)
	async delete(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.assets.delete).handler(({ input }) =>
			this.safe("delete", () => this.assetsService.delete(input, session.user.id))
		)
	}

	private async assetUploadWithIdempotency(
		actorId: string,
		request: PreparedAssetRequest,
		input: Parameters<AssetsService["upload"]>[1]
	) {
		const key = requireMatchingRequestId(request.headers["idempotency-key"], input.requestId)
		const prepared = getPreparedAssetUpload(request)
		return this.safe("upload", () =>
			this.idempotencyService.execute({
				authorId: actorId,
				key,
				method: "POST",
				path: "/api/v1/admin/pisocamp/assets",
				input: {
					fileSha256: prepared.sha256,
					itemId: input.itemId,
					expectedVersionNo: input.expectedVersionNo,
					role: input.role,
					requestId: input.requestId,
				},
				run: () => this.assetsService.upload(prepared, input, actorId),
			})
		)
	}

	private async safe<T>(operation: string, work: () => Promise<T>): Promise<T> {
		try {
			return await work()
		} catch (error) {
			if (error instanceof ORPCError) throw error
			this.logger.error(
				{ operation, errorName: error instanceof Error ? error.name : "Unknown" },
				"Unexpected asset operation failure"
			)
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Asset operation failed" })
		}
	}
}
