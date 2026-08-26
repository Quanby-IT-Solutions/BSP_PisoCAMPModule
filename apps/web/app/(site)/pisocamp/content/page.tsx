import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ContentListView } from "@/features/pisocamp-content-admin/components/content-list-view"

export const metadata: Metadata = {
	title: "Content",
}

export default async function PisoCampContentPage() {
	const access = await getAccess()
	const permitted = canAccess(
		{ roles: access.roles, permissions: access.permissions },
		{ requiredPermission: "content.items.edit" }
	)

	if (access.status !== "loaded" || !permitted) {
		redirect("/dashboard")
	}

	return <ContentListView />
}
