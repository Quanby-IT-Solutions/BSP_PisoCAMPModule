import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"

import { AuditService } from "@/common/audit/audit.service"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

/**
 * SA-4's viewer.
 *
 * The query is `AuditService.list` — the audit domain's own, extended with the
 * filters rather than copied. A second reader of `audit_log` that could disagree
 * with the first is not something an audit trail should have.
 */
@Controller()
export class PisoCampAuditViewerController {
	constructor(private readonly auditService: AuditService) {}

	@RequirePermissions("admin.audit.view")
	@Implement(v1.pisocamp.admin.audit.list)
	list() {
		return implement(v1.pisocamp.admin.audit.list).handler(async ({ input }) =>
			this.auditService.list(input)
		)
	}
}
