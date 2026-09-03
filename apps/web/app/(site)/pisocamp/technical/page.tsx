import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { TechnicalDashboard } from "@/features/analytics/components/technical-dashboard"

export const metadata: Metadata = {
	title: "Technical health",
}

export default async function PisoCampTechnicalPage() {
	const access = await getAccess()
	const identity = { roles: access.roles, permissions: access.permissions }

	if (!canAccess(identity, { requiredPermission: "reports.dashboards.view" })) {
		redirect("/dashboard")
	}

	// Reading technical health and feeding the module figures from outside it
	// are different permissions, so the entry form is only offered to somebody
	// who could actually save one.
	return (
		<TechnicalDashboard
			canRecord={canAccess(identity, { requiredPermission: "admin.integrations.manage" })}
		/>
	)
}
