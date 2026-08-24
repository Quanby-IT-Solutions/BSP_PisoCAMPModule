import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ModuleConfigurationView } from "@/features/pisocamp-admin/components/module-configuration-view"

export const metadata: Metadata = {
	title: "Module Configuration",
}

export default async function PisoCampConfigPage() {
	const access = await getAccess()

	if (
		!canAccess(
			{ roles: access.roles, permissions: access.permissions },
			{ requiredPermission: "admin.config.manage" }
		)
	) {
		redirect("/dashboard")
	}

	return <ModuleConfigurationView />
}
