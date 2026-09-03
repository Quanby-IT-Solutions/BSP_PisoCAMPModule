import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { DemographicsDashboard } from "@/features/analytics/components/demographics-dashboard"

export const metadata: Metadata = {
	title: "Demographics",
}

export default async function PisoCampDemographicsPage() {
	const access = await getAccess()
	const identity = { roles: access.roles, permissions: access.permissions }

	if (!canAccess(identity, { requiredPermission: "reports.dashboards.view" })) {
		redirect("/dashboard")
	}

	// Reading a cut and reading who is inside it are different authorisations
	// (§4.2-M), so the drill-down is only offered to somebody who holds the
	// second one — and the server refuses it regardless.
	return (
		<DemographicsDashboard
			canViewPii={canAccess(identity, { requiredPermission: "reports.pii.view" })}
		/>
	)
}
