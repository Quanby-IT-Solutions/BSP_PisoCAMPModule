import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { AuditLogView } from "@/features/pisocamp-admin/components/audit-log-view"

export const metadata: Metadata = {
	title: "Audit Log",
}

export default async function PisoCampAuditPage() {
	const access = await getAccess()

	if (
		!canAccess(
			{ roles: access.roles, permissions: access.permissions },
			{ requiredPermission: "admin.audit.view" }
		)
	) {
		redirect("/dashboard")
	}

	return <AuditLogView />
}
