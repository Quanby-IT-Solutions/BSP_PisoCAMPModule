import { and, eq } from "drizzle-orm"

import {
	AR_MANDATORY_EXPERIENCES,
	arExperienceKey,
	type ArMandatoryExperience,
} from "@repo/contracts/pisocamp-content"
import { contentItems, contentVersions } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

export interface ArCoverageReport {
	required: number
	covered: number
	/** The mandatory items with no published AR experience, in list order. */
	missing: ArMandatoryExperience[]
	/** Published experiences for something the mandatory list does not name. */
	unexpected: string[]
}

/**
 * AR-002/003. Which mandatory items have a published AR experience, and which
 * do not.
 *
 * Separated from the query so it can be checked against any set of published
 * experiences, including a hand-written one. A coverage figure nobody can
 * reproduce is a coverage figure nobody should sign off.
 */
export function summariseArCoverage(
	published: readonly { seriesCode: string | null; denominationCode: string | null }[]
): ArCoverageReport {
	const publishedKeys = new Set(
		published
			.filter(entry => entry.seriesCode && entry.denominationCode)
			.map(entry =>
				arExperienceKey({
					seriesCode: entry.seriesCode!,
					denominationCode: entry.denominationCode!,
				})
			)
	)
	const requiredKeys = new Set(AR_MANDATORY_EXPERIENCES.map(arExperienceKey))
	const missing = AR_MANDATORY_EXPERIENCES.filter(
		item => !publishedKeys.has(arExperienceKey(item))
	)

	return {
		required: AR_MANDATORY_EXPERIENCES.length,
		covered: AR_MANDATORY_EXPERIENCES.length - missing.length,
		missing: [...missing],
		// Reported rather than ignored: an experience for something not on the
		// list is either a list that is out of date or an item nobody approved,
		// and both are worth somebody's attention.
		unexpected: [...publishedKeys].filter(key => !requiredKeys.has(key)).sort(),
	}
}

/** The same summary, over what is actually published right now. */
export async function readArCoverage(): Promise<ArCoverageReport> {
	const rows = await db
		.select({
			seriesCode: contentVersions.seriesCode,
			denominationCode: contentVersions.denominationCode,
		})
		.from(contentItems)
		.innerJoin(contentVersions, eq(contentItems.currentPublishedVersionId, contentVersions.id))
		.where(
			and(
				eq(contentItems.contentType, "ar_experience"),
				eq(contentItems.status, "published"),
				eq(contentVersions.status, "published")
			)
		)
	return summariseArCoverage(rows)
}
