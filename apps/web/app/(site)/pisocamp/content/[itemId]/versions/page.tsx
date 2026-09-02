import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ContentVersionHistoryView } from "@/features/pisocamp-content-admin/components/content-version-history-view"

export const metadata: Metadata = {
	title: "Version History",
}

export default async function PisoCampContentVersionsPage({
	params,
}: {
	params: Promise<{ itemId: string }>
}) {
	const access = await getAccess()
	const canRestore = canAccess(
		{ roles: access.roles, permissions: access.permissions },
		{ requiredPermission: "content.items.restore" }
	)

	if (access.status !== "loaded" || !canRestore) {
		redirect("/dashboard")
	}

	const { itemId } = await params
	return <ContentVersionHistoryView itemId={itemId} canRestore={canRestore} />
}
