import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ContentReviewView } from "@/features/pisocamp-content-admin/components/content-review-view"

export const metadata: Metadata = {
	title: "Review Content",
}

export default async function PisoCampContentReviewDetailPage({
	params,
}: {
	params: Promise<{ itemId: string }>
}) {
	const access = await getAccess()
	const profile = { roles: access.roles, permissions: access.permissions }
	const canApprove = canAccess(profile, { requiredPermission: "content.items.approve" })
	const canPublish = canAccess(profile, { requiredPermission: "content.items.publish" })
	const canPreview = canAccess(profile, { requiredPermission: "content.items.preview" })
	const canRestore = canAccess(profile, { requiredPermission: "content.items.restore" })
	const canViewAudit = canAccess(profile, { requiredPermission: "content.audit.view" })

	if (access.status !== "loaded" || !canApprove) {
		redirect("/dashboard")
	}

	const { itemId } = await params
	return (
		<ContentReviewView
			itemId={itemId}
			canApprove={canApprove}
			canPreview={canPreview}
			canPublish={canPublish}
			canRestore={canRestore}
			canViewAudit={canViewAudit}
		/>
	)
}
