import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { ReportService } from "./report.service"

@Controller()
export class ReportsController {
	constructor(private readonly reports: ReportService) {}

	@RequirePermissions("reports.reports.generate")
	@Implement(v1.pisocamp.admin.reports.definitions)
	definitions() {
		return implement(v1.pisocamp.admin.reports.definitions).handler(async () =>
			this.reports.listDefinitions()
		)
	}

	@RequirePermissions("reports.reports.generate")
	@Implement(v1.pisocamp.admin.reports.generate)
	generate(@Session() session: UserSession) {
		return implement(v1.pisocamp.admin.reports.generate).handler(async ({ input }) =>
			this.reports.generate({ ...input, actorId: session.user.id })
		)
	}

	@RequirePermissions("reports.reports.generate")
	@Implement(v1.pisocamp.admin.reports.runs)
	runs() {
		return implement(v1.pisocamp.admin.reports.runs).handler(async ({ input }) =>
			this.reports.listRuns(input)
		)
	}
}
