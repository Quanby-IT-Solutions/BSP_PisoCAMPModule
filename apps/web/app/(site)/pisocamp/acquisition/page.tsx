import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { AcquisitionDashboard } from "@/features/analytics/components/acquisition-dashboard"

export const metadata: Metadata = {
	title: "Acquisition",
}

export default async function PisoCampAcquisitionPage() {
	const access = await getAccess()
	const identity = { roles: access.roles, permissions: access.permissions }

	if (!canAccess(identity, { requiredPermission: "reports.dashboards.view" })) {
		redirect("/dashboard")
	}

	// Reading the figures and feeding the module a store's report are different
	// permissions, as they are for the monitoring import.
	return (
		<AcquisitionDashboard
			canImport={canAccess(identity, { requiredPermission: "admin.integrations.manage" })}
		/>
	)
}
