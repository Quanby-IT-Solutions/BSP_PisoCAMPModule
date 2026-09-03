import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { NotificationsDashboard } from "@/features/notifications/components/notifications-dashboard"

export const metadata: Metadata = {
	title: "Notifications",
}

export default async function PisoCampNotificationsPage() {
	const access = await getAccess()
	const identity = { roles: access.roles, permissions: access.permissions }

	if (!canAccess(identity, { requiredPermission: "reports.dashboards.view" })) {
		redirect("/dashboard")
	}

	// Reading the rates and sending to everybody are different permissions, so
	// the form is only offered to somebody who could actually send.
	return (
		<NotificationsDashboard
			canSend={canAccess(identity, { requiredPermission: "admin.notifications.send" })}
		/>
	)
}
