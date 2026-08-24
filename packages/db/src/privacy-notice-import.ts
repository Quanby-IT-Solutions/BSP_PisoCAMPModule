import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"

import type { DBClient } from "./client.js"
import { privacyNotices } from "./schema.js"
import { BSP_PRIVACY_NOTICE_METADATA } from "./seed-catalog.js"

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const PRIVACY_NOTICE_BODY_FILE_ENV = "PISOCAMP_PRIVACY_NOTICE_BODY_FILE" as const
export const PRIVACY_NOTICE_SHA256_ENV = "PISOCAMP_PRIVACY_NOTICE_SHA256" as const

export function getPrivacyNoticeImportConfiguration(
	environment: Record<string, string | undefined>
): { bodyFile: string; expectedSha256: string } | undefined {
	const bodyFile = environment[PRIVACY_NOTICE_BODY_FILE_ENV]?.trim()
	const expectedSha256 = environment[PRIVACY_NOTICE_SHA256_ENV]?.trim()
	if (!bodyFile && !expectedSha256) return undefined
	if (!bodyFile || !expectedSha256) {
		throw new Error(
			`${PRIVACY_NOTICE_BODY_FILE_ENV} and ${PRIVACY_NOTICE_SHA256_ENV} must be configured together`
		)
	}
	return { bodyFile, expectedSha256 }
}

/**
 * Builds the canonical notice row only after an operator-supplied body matches
 * its independently approved digest. No legal copy is embedded in source.
 */
export function buildApprovedPrivacyNotice(input: { body: string; expectedSha256: string }) {
	if (input.body.trim().length === 0) {
		throw new Error("privacy notice body is required")
	}
	if (!SHA256_PATTERN.test(input.expectedSha256)) {
		throw new Error("privacy notice SHA-256 must be 64 lowercase hexadecimal characters")
	}

	const contentSha256 = createHash("sha256").update(input.body, "utf8").digest("hex")
	if (contentSha256 !== input.expectedSha256) {
		throw new Error("privacy notice body digest does not match approved SHA-256")
	}

	return {
		...BSP_PRIVACY_NOTICE_METADATA,
		body: input.body,
		contentSha256,
	}
}

/** Insert once, then verify that an existing immutable version is byte-for-byte identical. */
export async function importApprovedPrivacyNotice(
	database: Pick<DBClient, "insert" | "select">,
	input: { body: string; expectedSha256: string }
) {
	const notice = buildApprovedPrivacyNotice(input)
	await database.insert(privacyNotices).values(notice).onConflictDoNothing()
	const [stored] = await database
		.select()
		.from(privacyNotices)
		.where(eq(privacyNotices.version, notice.version))

	if (
		!stored ||
		stored.id !== notice.id ||
		stored.title !== notice.title ||
		stored.body !== notice.body ||
		stored.sourceUrl !== notice.sourceUrl ||
		stored.contentSha256 !== notice.contentSha256 ||
		stored.effectiveAt.getTime() !== notice.effectiveAt.getTime()
	) {
		throw new Error("stored privacy notice version does not match the approved import")
	}
	return stored
}
