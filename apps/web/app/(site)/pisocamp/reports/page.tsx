import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ReportBuilderView } from "@/features/reports/components/report-builder-view"

export const metadata: Metadata = {
	title: "Reports",
}

export default async function PisoCampReportsPage() {
	const access = await getAccess()

	if (
		!canAccess(
			{ roles: access.roles, permissions: access.permissions },
			{ requiredPermission: "reports.reports.generate" }
		)
	) {
		redirect("/dashboard")
	}

	return <ReportBuilderView />
}
