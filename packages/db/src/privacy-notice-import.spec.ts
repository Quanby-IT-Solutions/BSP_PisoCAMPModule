import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import {
	buildApprovedPrivacyNotice,
	getPrivacyNoticeImportConfiguration,
} from "./privacy-notice-import.js"

const body = "TEST FIXTURE ONLY — not approved legal copy."
const digest = createHash("sha256").update(body, "utf8").digest("hex")

describe("approved privacy notice import seam", () => {
	it("materializes the authoritative row only when the approved digest matches", () => {
		expect(buildApprovedPrivacyNotice({ body, expectedSha256: digest })).toMatchObject({
			version: "2024-12-26",
			body,
			contentSha256: digest,
		})
	})

	it("fails closed when the expected digest does not match", () => {
		expect(() => buildApprovedPrivacyNotice({ body, expectedSha256: "0".repeat(64) })).toThrow(
			"privacy notice body digest does not match"
		)
	})

	it("rejects an absent, empty, or malformed approval input", () => {
		expect(() => buildApprovedPrivacyNotice({ body: "", expectedSha256: digest })).toThrow()
		expect(() => buildApprovedPrivacyNotice({ body, expectedSha256: "not-a-digest" })).toThrow()
	})

	it("requires the body file and digest together while allowing a fail-closed omission", () => {
		expect(getPrivacyNoticeImportConfiguration({})).toBeUndefined()
		expect(() =>
			getPrivacyNoticeImportConfiguration({ PISOCAMP_PRIVACY_NOTICE_BODY_FILE: "notice.txt" })
		).toThrow("must be configured together")
		expect(
			getPrivacyNoticeImportConfiguration({
				PISOCAMP_PRIVACY_NOTICE_BODY_FILE: "notice.txt",
				PISOCAMP_PRIVACY_NOTICE_SHA256: digest,
			})
		).toEqual({ bodyFile: "notice.txt", expectedSha256: digest })
	})
})
