import { asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type {
	PisoCampContentDetail,
	PisoCampContentDraft,
	PisoCampRelatedLinkOutput,
} from "@repo/contracts"
import { contentItems, contentVersions, relatedLinks, users } from "@repo/db/schema"

import type { DatabaseTransaction } from "@/common/database/database-transaction.context"
import { type db } from "@/common/database/database.client"

export type ContentDatabase = typeof db | DatabaseTransaction

const creator = alias(users, "content_detail_creator")
const editor = alias(users, "content_detail_editor")

export function toContentVersionValues(content: PisoCampContentDraft) {
	return {
		contentType: content.contentType,
		title: content.title,
		summary: content.summary,
		body: "body" in content ? (content.body ?? null) : null,
		seriesCode: "seriesCode" in content ? content.seriesCode : null,
		denominationCode: "denominationCode" in content ? content.denominationCode : null,
		primaryUrl: "primaryUrl" in content ? content.primaryUrl : null,
	}
}

export function fromContentVersion(row: {
	contentType: PisoCampContentDraft["contentType"]
	title: string
	summary: string
	body: string | null
	seriesCode: string | null
	denominationCode: string | null
	primaryUrl: string | null
}): PisoCampContentDraft {
	const common = { contentType: row.contentType, title: row.title, summary: row.summary }
	if (row.contentType === "link") {
		return {
			...common,
			contentType: "link",
			...(row.body === null ? {} : { body: row.body }),
			primaryUrl: row.primaryUrl!,
		}
	}
	if (row.contentType === "advisory") {
		return { ...common, contentType: "advisory", body: row.body! }
	}
	return {
		...common,
		contentType: row.contentType,
		body: row.body!,
		seriesCode: row.seriesCode as never,
		denominationCode: row.denominationCode!,
	} as PisoCampContentDraft
}

export async function selectContentLinks(
	database: ContentDatabase,
	versionId: string
): Promise<PisoCampRelatedLinkOutput[]> {
	return (await selectContentLinksByVersionIds(database, [versionId])).get(versionId) ?? []
}

export async function selectContentLinksByVersionIds(
	database: ContentDatabase,
	versionIds: readonly string[]
): Promise<Map<string, PisoCampRelatedLinkOutput[]>> {
	const grouped = new Map(
		versionIds.map(versionId => [versionId, [] as PisoCampRelatedLinkOutput[]])
	)
	if (!versionIds.length) return grouped
	const rows = await database
		.select()
		.from(relatedLinks)
		.where(inArray(relatedLinks.contentVersionId, versionIds))
		.orderBy(asc(relatedLinks.contentVersionId), asc(relatedLinks.position), asc(relatedLinks.id))
	for (const row of rows) {
		const base = { id: row.id, position: row.position, label: row.label }
		const mapped =
			row.kind === "external"
				? ({ ...base, kind: "external", url: row.externalUrl! } as const)
				: row.kind === "internal"
					? ({ ...base, kind: "internal", route: row.internalRoute! } as const)
					: ({ ...base, kind: "topic", targetContentItemId: row.targetContentItemId! } as const)
		grouped.get(row.contentVersionId)!.push(mapped)
	}
	return grouped
}

export async function getContentDetail(
	database: ContentDatabase,
	itemId: string
): Promise<PisoCampContentDetail | null> {
	const [row] = await database
		.select({
			id: contentItems.id,
			contentType: contentItems.contentType,
			status: contentItems.status,
			createdAt: contentItems.createdAt,
			dateModified: contentItems.updatedAt,
			creatorId: creator.id,
			creatorName: creator.name,
			editorId: editor.id,
			editorName: editor.name,
			versionId: contentVersions.id,
			versionNo: contentVersions.versionNo,
			versionStatus: contentVersions.status,
			title: contentVersions.title,
			summary: contentVersions.summary,
			body: contentVersions.body,
			seriesCode: contentVersions.seriesCode,
			denominationCode: contentVersions.denominationCode,
			primaryUrl: contentVersions.primaryUrl,
		})
		.from(contentItems)
		.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
		.innerJoin(creator, eq(contentItems.createdBy, creator.id))
		.innerJoin(editor, eq(contentItems.lastEditedBy, editor.id))
		.where(eq(contentItems.id, itemId))
	if (!row) return null
	return {
		id: row.id,
		contentType: row.contentType,
		status: row.status,
		currentVersion: {
			id: row.versionId,
			versionNo: row.versionNo,
			status: row.versionStatus,
			content: fromContentVersion(row),
			relatedLinks: await selectContentLinks(database, row.versionId),
		},
		creator: { id: row.creatorId, name: row.creatorName },
		lastEditor: { id: row.editorId, name: row.editorName },
		createdAt: row.createdAt.toISOString(),
		dateModified: row.dateModified.toISOString(),
	}
}
