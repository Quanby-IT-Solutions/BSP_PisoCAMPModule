import { asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

// The subpath, not the package root: the root pulls the ESM oRPC contract in,
// and these two constants are plain data.
import { NPS_BANDS, SURVEY_SCALES } from "@repo/contracts/pisocamp-content"
import type {
	PisoCampContentDetail,
	PisoCampContentDraft,
	PisoCampRelatedLinkOutput,
	PisoCampSurveyQuestion,
} from "@repo/contracts"
import {
	contentItems,
	contentVersions,
	relatedLinks,
	surveyDetails,
	surveyQuestions,
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

/**
 * The EV-1 child row for a version, or null when the content is not a survey.
 */
export function toSurveyDetailValues(
	content: PisoCampContentDraft,
	identity: { contentItemId: string; contentVersionId: string }
) {
	if (content.contentType !== "survey") return null
	return {
		contentVersionId: identity.contentVersionId,
		contentItemId: identity.contentItemId,
		purpose: content.purpose,
		subjectContentItemId: content.subjectContentItemId ?? null,
	}
}

/**
 * A survey's questions, in the order the editor arranged them.
 *
 * Position is the array index rather than an input: an editor moves a question
 * by moving it, and two questions claiming position 3 is a state the form
 * should not be able to express.
 */
export function toSurveyQuestionValues(
	content: PisoCampContentDraft,
	identity: { contentItemId: string; contentVersionId: string }
) {
	if (content.contentType !== "survey") return null
	return content.questions.map((question, position) => ({
		contentVersionId: identity.contentVersionId,
		contentItemId: identity.contentItemId,
		position,
		kind: question.kind,
		prompt: question.prompt,
		required: question.required,
		// The scale and the NPS bands are the kind's, not the editor's, so they
		// are written from the contract's constants and never from input.
		scaleMin: question.kind === "text" ? null : SURVEY_SCALES[question.kind].min,
		scaleMax: question.kind === "text" ? null : SURVEY_SCALES[question.kind].max,
		lowLabel: question.kind === "text" ? null : question.lowLabel,
		highLabel: question.kind === "text" ? null : question.highLabel,
		npsPromoterMin: question.kind === "nps" ? NPS_BANDS.promoterMin : null,
		npsPassiveMin: question.kind === "nps" ? NPS_BANDS.passiveMin : null,
	}))
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

/**
 * EV-1 fields, joined from `survey_detail` and fetched from `survey_question`.
 * All null for anything that is not a survey.
 */
export interface SurveyDetailRow {
	surveyPurpose: "topic" | "satisfaction" | "feature" | "application" | "nps" | "usefulness" | null
	surveySubjectContentItemId: string | null
	surveyQuestions: PisoCampSurveyQuestion[] | null
}

/** The survey columns every version select joins. Questions are their own read. */
export const surveyDetailColumns = {
	surveyPurpose: surveyDetails.purpose,
	surveySubjectContentItemId: surveyDetails.subjectContentItemId,
} as const

/** Every child-table column a version select needs, in one spread. */
export const childDetailColumns = { ...triviaDetailColumns, ...surveyDetailColumns } as const

/**
 * A survey's questions by version, ordered.
 *
 * A separate read rather than a join because a version has many questions and
 * joining them would multiply every other column by the question count.
 */
export async function selectSurveyQuestionsByVersionIds(
	database: ContentDatabase,
	versionIds: readonly string[]
): Promise<Map<string, PisoCampSurveyQuestion[]>> {
	const grouped = new Map(versionIds.map(id => [id, [] as PisoCampSurveyQuestion[]]))
	if (!versionIds.length) return grouped
	const rows = await database
		.select()
		.from(surveyQuestions)
		.where(inArray(surveyQuestions.contentVersionId, versionIds))
		.orderBy(asc(surveyQuestions.contentVersionId), asc(surveyQuestions.position))
	for (const row of rows) {
		grouped.get(row.contentVersionId)?.push(
			row.kind === "text"
				? { kind: "text", prompt: row.prompt, required: row.required }
				: {
						kind: row.kind,
						prompt: row.prompt,
						required: row.required,
						lowLabel: row.lowLabel!,
						highLabel: row.highLabel!,
					}
		)
	}
	return grouped
}

/** Attaches one version's questions, for the callers that hold a joined row. */
export async function withSurveyQuestionsFor<T extends { contentType: string }>(
	database: ContentDatabase,
	versionId: string,
	row: T
): Promise<T & { surveyQuestions: PisoCampSurveyQuestion[] | null }> {
	if (row.contentType !== "survey") return { ...row, surveyQuestions: null }
	const grouped = await selectSurveyQuestionsByVersionIds(database, [versionId])
	return { ...row, surveyQuestions: grouped.get(versionId) ?? [] }
}

export interface ContentVersionRow extends TriviaDetailRow, SurveyDetailRow {
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
	if (row.contentType === "survey") {
		return {
			...common,
			contentType: "survey",
			body: row.body!,
			purpose: row.surveyPurpose!,
			subjectContentItemId: row.surveySubjectContentItemId,
			questions: row.surveyQuestions ?? [],
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
 * Merges a version's child rows onto a whole-table select.
 *
 * The joined selects read the child columns directly; this is for the callers
 * that already hold a full `content_version` row and would otherwise render a
 * question with no choices or a survey with no questions.
 */
export async function withChildDetails<
	T extends { id: string; contentType: PisoCampContentDraft["contentType"] },
>(database: ContentDatabase, version: T): Promise<T & TriviaDetailRow & SurveyDetailRow> {
	const empty = {
		triviaCategory: null,
		triviaDifficulty: null,
		triviaChoices: null,
		triviaActive: null,
		surveyPurpose: null,
		surveySubjectContentItemId: null,
		surveyQuestions: null,
	} as const
	if (version.contentType === "trivia_question") {
		const [detail] = await database
			.select(triviaDetailColumns)
			.from(triviaQuestionDetails)
			.where(eq(triviaQuestionDetails.contentVersionId, version.id))
		return {
			...version,
			...empty,
			triviaCategory: detail?.triviaCategory ?? null,
			triviaDifficulty: detail?.triviaDifficulty ?? null,
			triviaChoices: detail?.triviaChoices ?? null,
			triviaActive: detail?.triviaActive ?? null,
		}
	}
	if (version.contentType === "survey") {
		const [detail] = await database
			.select(surveyDetailColumns)
			.from(surveyDetails)
			.where(eq(surveyDetails.contentVersionId, version.id))
		const grouped = await selectSurveyQuestionsByVersionIds(database, [version.id])
		return {
			...version,
			...empty,
			surveyPurpose: detail?.surveyPurpose ?? null,
			surveySubjectContentItemId: detail?.surveySubjectContentItemId ?? null,
			surveyQuestions: grouped.get(version.id) ?? [],
		}
	}
	return { ...version, ...empty }
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
			...childDetailColumns,
		})
		.from(contentItems)
		.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
		.innerJoin(creator, eq(contentItems.createdBy, creator.id))
		.innerJoin(editor, eq(contentItems.lastEditedBy, editor.id))
		.leftJoin(
			triviaQuestionDetails,
			eq(triviaQuestionDetails.contentVersionId, contentVersions.id)
		)
		.leftJoin(surveyDetails, eq(surveyDetails.contentVersionId, contentVersions.id))
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
			content: fromContentVersion(
				await withSurveyQuestionsFor(database, row.versionId, row)
			),
			relatedLinks: await selectContentLinks(database, row.versionId),
		},
		creator: { id: row.creatorId, name: row.creatorName },
		lastEditor: { id: row.editorId, name: row.editorName },
		createdAt: row.createdAt.toISOString(),
		dateModified: row.dateModified.toISOString(),
	}
}
