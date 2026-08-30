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
