import { createHash } from "node:crypto"

import type { PisoCampPublishedBundleCandidate } from "../content/content-workflow.service"

export interface RenderedBundleResource {
	logicalId: string
	bytes: Buffer
	sha256: string
	byteLength: number
	mediaType: "application/json"
	kind: "content"
	delivery: "core"
	contentItemId: string
	contentVersionId: string
}

export function renderPublishedContentResources(
	candidates: readonly PisoCampPublishedBundleCandidate[]
): RenderedBundleResource[] {
	return candidates
		.map(candidate => {
			const logicalId = `content.${candidate.itemId}`
			const content = candidate.content
			const bytes = Buffer.from(
				JSON.stringify({
					schemaVersion: 1,
					logicalId,
					contentItemId: candidate.itemId,
					contentVersionId: candidate.versionId,
					versionNo: candidate.versionNo,
					contentType: content.contentType,
					title: content.title,
					summary: content.summary,
					body: "body" in content ? (content.body ?? null) : null,
					seriesCode: "seriesCode" in content ? content.seriesCode : null,
					denominationCode: "denominationCode" in content ? content.denominationCode : null,
					primaryUrl: "primaryUrl" in content ? content.primaryUrl : null,
					// Only ever "first": a second-level feature is dropped before it
					// reaches the renderer, so the field a device reads can never
					// say otherwise.
					featureLevel: "featureLevel" in content ? content.featureLevel : null,
					hotspot: "hotspot" in content ? (content.hotspot ?? null) : null,
					// GM-1 fields, and only for a question: a currency document
					// carrying them would fail the client's exact-key check, which
					// is how the two shapes stay distinguishable.
					...(content.contentType === "trivia_question"
						? {
								category: content.category,
								difficulty: content.difficulty,
								choices: content.choices,
							}
						: {}),
					// EV-1 fields, and only for a survey. A survey travels with its
					// questions because EV-2 presents it offline, and a survey with
					// no questions is nothing to present.
					...(content.contentType === "survey"
						? {
								purpose: content.purpose,
								subjectContentItemId: content.subjectContentItemId ?? null,
								// With their ids: a response has to name the question it
								// answers, and the draft shape does not carry one.
								questions: candidate.surveyQuestions ?? [],
							}
						: {}),
					relatedLinks: candidate.relatedLinks,
				}),
				"utf8"
			)
			return {
				logicalId,
				bytes,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				byteLength: bytes.byteLength,
				mediaType: "application/json" as const,
				kind: "content" as const,
				delivery: "core" as const,
				contentItemId: candidate.itemId,
				contentVersionId: candidate.versionId,
			}
		})
		.sort((left, right) => left.logicalId.localeCompare(right.logicalId))
}
