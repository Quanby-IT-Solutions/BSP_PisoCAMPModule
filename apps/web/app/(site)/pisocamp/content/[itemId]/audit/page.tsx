import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ContentAuditView } from "@/features/pisocamp-content-admin/components/content-audit-view"

export const metadata: Metadata = {
	title: "Audit History",
}

export default async function PisoCampContentAuditPage({
	params,
}: {
	params: Promise<{ itemId: string }>
}) {
	const access = await getAccess()
	const canViewAudit = canAccess(
		{ roles: access.roles, permissions: access.permissions },
		{ requiredPermission: "content.audit.view" }
	)

	if (access.status !== "loaded" || !canViewAudit) {
		redirect("/dashboard")
	}

	const { itemId } = await params
	return <ContentAuditView itemId={itemId} />
}
