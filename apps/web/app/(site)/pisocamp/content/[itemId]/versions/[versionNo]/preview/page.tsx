import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { ContentPreviewView } from "@/features/pisocamp-content-admin/components/content-preview-view"

export const metadata: Metadata = {
	title: "Preview Content",
}

export default async function PisoCampContentPreviewPage({
	params,
}: {
	params: Promise<{ itemId: string; versionNo: string }>
}) {
	const access = await getAccess()
	const permitted = canAccess(
		{ roles: access.roles, permissions: access.permissions },
		{ requiredPermission: "content.items.preview" }
	)

	if (access.status !== "loaded" || !permitted) {
		redirect("/dashboard")
	}

	const { itemId, versionNo } = await params
	const parsedVersionNo = Number(versionNo)
	if (!Number.isSafeInteger(parsedVersionNo) || parsedVersionNo < 1) {
		notFound()
	}

	return <ContentPreviewView itemId={itemId} versionNo={parsedVersionNo} />
}
