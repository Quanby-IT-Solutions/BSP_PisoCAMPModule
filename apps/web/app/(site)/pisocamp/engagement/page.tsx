import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { EngagementDashboard } from "@/features/analytics/components/engagement-dashboard"

export const metadata: Metadata = {
	title: "Engagement",
}

export default async function PisoCampEngagementPage() {
	const access = await getAccess()

	if (
		!canAccess(
			{ roles: access.roles, permissions: access.permissions },
			{ requiredPermission: "reports.dashboards.view" }
		)
	) {
		redirect("/dashboard")
	}

	return <EngagementDashboard />
}
