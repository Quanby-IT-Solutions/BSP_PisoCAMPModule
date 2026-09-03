import { createHash } from "node:crypto"

import type { PisoCampPublishedBundleCandidate } from "../content/content-workflow.service"

/**
 * How a content item is named to a device.
 *
 * A device reports what it did by logical id, so anything that maps a report
 * back to the item it was about has to use the same rule. One definition, here,
 * rather than the same string built twice.
 */
export const CONTENT_LOGICAL_ID_PREFIX = "content."

export function contentLogicalId(itemId: string): string {
	return `${CONTENT_LOGICAL_ID_PREFIX}${itemId}`
}

export interface RenderedBundleResource {
	logicalId: string
	bytes: Buffer
	sha256: string
	byteLength: number
	mediaType: "application/json" | "application/octet-stream"
	kind: "content" | "recognition_model"
	delivery: "core"
	contentItemId: string | null
	contentVersionId: string | null
}

/**
 * What DR-1's reader looks for in the bundle.
 *
 * Two entries, because the descriptor is readable JSON the device validates and
 * the weights are opaque bytes it only checks the digest of. One definition,
 * here, rather than the same strings written on both sides of the wire.
 */
export const RECOGNITION_DESCRIPTOR_LOGICAL_ID = "recognition-model.active"
export const RECOGNITION_WEIGHTS_LOGICAL_ID = "recognition-model.weights"

export interface ActiveRecognitionModel {
	version: string
	thresholds: { confidence: number; dwellSeconds: number }
	classes: unknown[]
	weightsSha256: string
	weightsByteLength: number
}

/**
 * The descriptor a device reads, and the manifest entry for the weights.
 *
 * The weights themselves are already in the object store — they were put there
 * when the model was published — so only their manifest entry is produced here.
 */
export function renderRecognitionModelResources(
	model: ActiveRecognitionModel
): RenderedBundleResource[] {
	const descriptor = Buffer.from(
		JSON.stringify({
			schemaVersion: 1,
			version: model.version,
			// Carried with the model rather than read from module configuration:
			// a confidence approved against one set of weights must not govern
			// another, and the bundle is the one place a device sees both at once.
			thresholds: model.thresholds,
			classes: model.classes,
		}),
		"utf8"
	)
	return [
		{
			logicalId: RECOGNITION_DESCRIPTOR_LOGICAL_ID,
			bytes: descriptor,
			sha256: createHash("sha256").update(descriptor).digest("hex"),
			byteLength: descriptor.byteLength,
			mediaType: "application/json" as const,
			kind: "recognition_model" as const,
			delivery: "core" as const,
			contentItemId: null,
			contentVersionId: null,
		},
		{
			logicalId: RECOGNITION_WEIGHTS_LOGICAL_ID,
			// Never re-read here: the object store already holds them under this
			// digest, and loading several megabytes into every build to hash them
			// again would prove nothing the digest does not already say.
			bytes: Buffer.alloc(0),
			sha256: model.weightsSha256,
			byteLength: model.weightsByteLength,
			mediaType: "application/octet-stream" as const,
			kind: "recognition_model" as const,
			delivery: "core" as const,
			contentItemId: null,
			contentVersionId: null,
		},
	]
}

export function renderPublishedContentResources(
	candidates: readonly PisoCampPublishedBundleCandidate[]
): RenderedBundleResource[] {
	return candidates
		.map(candidate => {
			const logicalId = contentLogicalId(candidate.itemId)
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
