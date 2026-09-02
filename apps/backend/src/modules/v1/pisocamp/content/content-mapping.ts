import { asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type {
	PisoCampContentDetail,
	PisoCampContentDraft,
	PisoCampRelatedLinkOutput,
} from "@repo/contracts"
import {
	contentItems,
	contentVersions,
	relatedLinks,
	triviaQuestionDetails,
	users,
} from "@repo/db/schema"

import type { DatabaseTransaction } from "@/common/database/database-transaction.context"
import { type db } from "@/common/database/database.client"

export type ContentDatabase = typeof db | DatabaseTransaction

const creator = alias(users, "content_detail_creator")
const editor = alias(users, "content_detail_editor")

/**
 * The GM-1 child row for a version, or null when the content is not a question.
 *
 * Separate from [toContentVersionValues] because it writes a different table:
 * the workflow copies both together, and neither may exist without the other.
 */
export function toTriviaDetailValues(
	content: PisoCampContentDraft,
	identity: { contentItemId: string; contentVersionId: string }
) {
	if (content.contentType !== "trivia_question") return null
	return {
		contentVersionId: identity.contentVersionId,
		contentItemId: identity.contentItemId,
		category: content.category,
		difficulty: content.difficulty,
		choices: content.choices,
		active: content.active,
	}
}

export function toContentVersionValues(content: PisoCampContentDraft) {
	return {
		contentType: content.contentType,
		title: content.title,
		summary: content.summary,
		body: "body" in content ? (content.body ?? null) : null,
		seriesCode: "seriesCode" in content ? content.seriesCode : null,
		denominationCode: "denominationCode" in content ? content.denominationCode : null,
		primaryUrl: "primaryUrl" in content ? content.primaryUrl : null,
		featureLevel: "featureLevel" in content ? content.featureLevel : null,
		hotspotXPermille: "hotspot" in content ? (content.hotspot?.x ?? null) : null,
		hotspotYPermille: "hotspot" in content ? (content.hotspot?.y ?? null) : null,
	}
}

export interface TriviaChoiceRow {
	label: string
	correct: boolean
}

/**
 * GM-1 fields, joined from `trivia_question_detail`. All null for anything that
 * is not a question, which is what the left join yields.
 */
export interface TriviaDetailRow {
	triviaCategory: string | null
	triviaDifficulty: "easy" | "medium" | "hard" | null
	triviaChoices: TriviaChoiceRow[] | null
	triviaActive: boolean | null
}

/** The trivia columns every version select joins, so one shape reads them all. */
export const triviaDetailColumns = {
	triviaCategory: triviaQuestionDetails.category,
	triviaDifficulty: triviaQuestionDetails.difficulty,
	triviaChoices: triviaQuestionDetails.choices,
	triviaActive: triviaQuestionDetails.active,
} as const

export interface ContentVersionRow extends TriviaDetailRow {
	contentType: PisoCampContentDraft["contentType"]
	title: string
	summary: string
	body: string | null
	seriesCode: string | null
	denominationCode: string | null
	primaryUrl: string | null
	featureLevel: "first" | "second" | null
	hotspotXPermille: number | null
	hotspotYPermille: number | null
}

export function fromContentVersion(row: ContentVersionRow): PisoCampContentDraft {
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
	if (row.contentType === "trivia_question") {
		return {
			...common,
			contentType: "trivia_question",
			body: row.body!,
			category: row.triviaCategory!,
			difficulty: row.triviaDifficulty!,
			choices: row.triviaChoices ?? [],
			active: row.triviaActive ?? true,
		}
	}
	if (row.contentType === "security_feature") {
		return {
			...common,
			contentType: "security_feature",
			body: row.body!,
			seriesCode: row.seriesCode as never,
			denominationCode: row.denominationCode!,
			featureLevel: row.featureLevel!,
			hotspot:
				row.hotspotXPermille === null || row.hotspotYPermille === null
					? null
					: { x: row.hotspotXPermille, y: row.hotspotYPermille },
		}
	}
	return {
		...common,
		contentType: row.contentType,
		body: row.body!,
		seriesCode: row.seriesCode as never,
		denominationCode: row.denominationCode!,
	} as PisoCampContentDraft
}

/**
 * Merges a version's GM-1 child row onto a whole-table select.
 *
 * The joined selects read the trivia columns directly; this is for the two
 * callers that already hold a full `content_version` row and would otherwise
 * render a question with no choices.
 */
export async function withTriviaDetail<
	T extends { id: string; contentType: PisoCampContentDraft["contentType"] },
>(database: ContentDatabase, version: T): Promise<T & TriviaDetailRow> {
	if (version.contentType !== "trivia_question") {
		return {
			...version,
			triviaCategory: null,
			triviaDifficulty: null,
			triviaChoices: null,
			triviaActive: null,
		}
	}
	const [detail] = await database
		.select(triviaDetailColumns)
		.from(triviaQuestionDetails)
		.where(eq(triviaQuestionDetails.contentVersionId, version.id))
	return {
		...version,
		triviaCategory: detail?.triviaCategory ?? null,
		triviaDifficulty: detail?.triviaDifficulty ?? null,
		triviaChoices: detail?.triviaChoices ?? null,
		triviaActive: detail?.triviaActive ?? null,
	}
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
			featureLevel: contentVersions.featureLevel,
			hotspotXPermille: contentVersions.hotspotXPermille,
			hotspotYPermille: contentVersions.hotspotYPermille,
			...triviaDetailColumns,
		})
		.from(contentItems)
		.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
		.innerJoin(creator, eq(contentItems.createdBy, creator.id))
		.innerJoin(editor, eq(contentItems.lastEditedBy, editor.id))
		.leftJoin(
			triviaQuestionDetails,
			eq(triviaQuestionDetails.contentVersionId, contentVersions.id)
		)
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
