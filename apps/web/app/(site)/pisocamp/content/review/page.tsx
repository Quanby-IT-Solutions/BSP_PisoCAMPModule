import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ContentReviewQueueView } from "@/features/pisocamp-content-admin/components/content-review-queue-view"

export const metadata: Metadata = {
	title: "Content Review",
}

export default async function PisoCampContentReviewPage() {
	const access = await getAccess()
	const canReview = canAccess(
		{ roles: access.roles, permissions: access.permissions },
		{ requiredPermission: "content.items.approve" }
	)

	if (access.status !== "loaded" || !canReview) {
		redirect("/dashboard")
	}

	return <ContentReviewQueueView canReview={canReview} />
}
