import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { AccountManagementView } from "@/features/pisocamp-admin/components/account-management-view"

export const metadata: Metadata = {
	title: "Accounts",
}

export default async function PisoCampAccountsPage() {
	const access = await getAccess()

	if (
		!canAccess(
			{ roles: access.roles, permissions: access.permissions },
			{ requiredPermission: "admin.accounts.manage" }
		)
	) {
		redirect("/dashboard")
	}

	return <AccountManagementView />
}
