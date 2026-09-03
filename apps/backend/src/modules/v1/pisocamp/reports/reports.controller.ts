import { Controller, Get, HttpStatus, Param, Res } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import {
	REPORT_EXPORT_FORMATS,
	type ReportExportFormat,
} from "@repo/contracts/pisocamp-report"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { ReportExportService } from "./report-export.service"
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

/**
 * AN-9's download.
 *
 * A plain Nest controller rather than an oRPC handler, as the bundle resource
 * route already is: the body is a file, and a JSON envelope around it would
 * mean the browser could not simply save it.
 */
@Controller({ path: "admin/pisocamp/reports/runs", version: "1" })
export class ReportExportController {
	constructor(private readonly exports: ReportExportService) {}

	@RequirePermissions("reports.reports.export")
	@Get(":runId/export/:format")
	async download(
		@Param("runId") runId: string,
		@Param("format") format: string,
		@Session() session: UserSession,
		@Res() response: Response
	): Promise<void> {
		if (!(REPORT_EXPORT_FORMATS as readonly string[]).includes(format)) {
			response.status(HttpStatus.NOT_FOUND).end()
			return
		}

		const rendered = await this.exports.export({
			runId,
			format: format as ReportExportFormat,
			actorId: session.user.id,
		})
		if (!rendered) {
			response.status(HttpStatus.NOT_FOUND).end()
			return
		}

		response.setHeader("Content-Type", rendered.mediaType)
		response.setHeader("Content-Length", rendered.bytes.byteLength)
		// An export is a file to keep, not a page to look at.
		response.setHeader(
			"Content-Disposition",
			`attachment; filename="${rendered.fileName}"`
		)
		response.status(HttpStatus.OK).send(rendered.bytes)
	}
}
