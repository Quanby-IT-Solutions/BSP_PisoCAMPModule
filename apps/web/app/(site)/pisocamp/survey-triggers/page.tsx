import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { SurveyTriggersView } from "@/features/pisocamp-admin/components/survey-triggers-view"

export const metadata: Metadata = {
	title: "Survey Triggers",
}

export default async function PisoCampSurveyTriggersPage() {
	const access = await getAccess()

	if (
		!canAccess(
			{ roles: access.roles, permissions: access.permissions },
			{ requiredPermission: "surveys.triggers.configure" }
		)
	) {
		redirect("/dashboard")
	}

	return <SurveyTriggersView />
}
