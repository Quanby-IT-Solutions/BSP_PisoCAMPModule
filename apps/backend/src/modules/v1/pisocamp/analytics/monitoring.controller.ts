import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { MonitoringImportService } from "./monitoring-import.service"

/**
 * AN-7's write side.
 *
 * Separate from the dashboard because the permissions are different in kind:
 * reading technical health is a reporting question, while feeding the module
 * figures from an outside tool is an integration one.
 */
@Controller()
export class MonitoringController {
	constructor(private readonly monitoring: MonitoringImportService) {}

	@RequirePermissions("admin.integrations.manage")
	@Implement(v1.pisocamp.monitoring.import)
	import(@Session() session: UserSession) {
		return implement(v1.pisocamp.monitoring.import).handler(({ input }) =>
			this.monitoring.importMetrics(input, session.user.id)
		)
	}

	@RequirePermissions("admin.integrations.manage")
	@Implement(v1.pisocamp.monitoring.recordPerformanceTest)
	recordPerformanceTest(@Session() session: UserSession) {
		return implement(v1.pisocamp.monitoring.recordPerformanceTest).handler(({ input }) =>
			this.monitoring.recordPerformanceTest(input, session.user.id)
		)
	}
}
