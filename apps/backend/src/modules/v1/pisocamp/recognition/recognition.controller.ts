import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { RecognitionModelError, RecognitionService } from "./recognition.service"

/**
 * DR-4. Publishing the recognition model and its thresholds.
 *
 * Everything here is behind `admin.config.manage`, and the guard records a
 * refused attempt: replacing the weights every device runs on people's money is
 * exactly the change that has to leave a trace whether it succeeds or not.
 */
@Controller()
export class RecognitionController {
	constructor(private readonly recognition: RecognitionService) {}

	@RequirePermissions("admin.config.manage")
	@Implement(v1.pisocamp.admin.recognition.list)
	async list() {
		return implement(v1.pisocamp.admin.recognition.list).handler(() =>
			this.safe(() => this.recognition.list())
		)
	}

	@StrictThrottle()
	@RequirePermissions("admin.config.manage")
	@Implement(v1.pisocamp.admin.recognition.publish)
	async publish(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.recognition.publish).handler(async ({ input }) =>
			this.safe(async () =>
				this.recognition.publish(
					input,
					Buffer.from(await input.file.arrayBuffer()),
					session.user.id
				)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions("admin.config.manage")
	@Implement(v1.pisocamp.admin.recognition.updateThresholds)
	async updateThresholds(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.recognition.updateThresholds).handler(({ input }) =>
			this.safe(() => this.recognition.updateThresholds(input, session.user.id))
		)
	}

	/**
	 * Turns the service's named failures into the status each one means.
	 *
	 * Anything unnamed is left to the global filter rather than flattened into a
	 * 400: a message invented here would say the caller got it wrong when the
	 * server did.
	 */
	private async safe<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run()
		} catch (error) {
			if (error instanceof RecognitionModelError) {
				if (error.code === "recognition_model_not_found") {
					throw new ORPCError("NOT_FOUND", { message: error.code })
				}
				if (error.code === "recognition_model_version_exists") {
					throw new ORPCError("CONFLICT", { message: error.code })
				}
			}
			throw error
		}
	}
}
