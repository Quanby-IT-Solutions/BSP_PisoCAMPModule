import { describe, expect, it } from "vitest"

import {
	IngestSurveyResponsesInputSchema,
	MAX_SURVEY_RESPONSE_BATCH,
	PisoCampSurveyResponseSchema,
} from "./survey-response.schema.js"

const RATING = "aa11bb22-cc33-4d44-8e55-ff6677889900"
const TEXT = "bb22cc33-dd44-4e55-8f66-001122334455"

const base = {
	responseId: "7c1f9a2e-3b4d-4e5f-8a6b-9c0d1e2f3a4b",
	contentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
	contentVersionId: "0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74",
	consentRecordId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
	submittedAt: "2026-09-02T04:05:06.000Z",
	answers: [
		{ kind: "scale", questionId: RATING, value: 4 },
		{ kind: "text", questionId: TEXT, value: "Nothing, it was clear." },
	],
}

describe("PisoCampSurveyResponseSchema", () => {
	it("takes a score, a written answer and a skip", () => {
		expect(PisoCampSurveyResponseSchema.safeParse(base).success).toBe(true)
		expect(
			PisoCampSurveyResponseSchema.safeParse({
				...base,
				answers: [{ kind: "skipped", questionId: RATING }],
			}).success
		).toBe(true)
	})

	it("names the grant the answer was given under", () => {
		// Without it there is no evidence the person was asked, and the server
		// has nothing to check the answer against.
		const withoutConsent = Object.fromEntries(
			Object.entries(base).filter(([key]) => key !== "consentRecordId")
		)
		expect(PisoCampSurveyResponseSchema.safeParse(withoutConsent).success).toBe(false)
	})

	it("refuses a question answered twice", () => {
		const result = PisoCampSurveyResponseSchema.safeParse({
			...base,
			answers: [
				{ kind: "scale", questionId: RATING, value: 4 },
				{ kind: "scale", questionId: RATING, value: 5 },
			],
		})

		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["answers", 1, "questionId"])
	})

	it.each([
		["a score below zero", { kind: "scale", questionId: RATING, value: -1 }],
		["a score above ten", { kind: "scale", questionId: RATING, value: 11 }],
		["a fractional score", { kind: "scale", questionId: RATING, value: 4.5 }],
		["a blank written answer", { kind: "text", questionId: TEXT, value: "   " }],
		["markup in a written answer", { kind: "text", questionId: TEXT, value: "<b>Nice</b>" }],
		["an unknown answer kind", { kind: "drawing", questionId: TEXT, value: "x" }],
		["a skip carrying a value", { kind: "skipped", questionId: TEXT, value: 3 }],
	])("refuses %s", (_label, answer) => {
		expect(PisoCampSurveyResponseSchema.safeParse({ ...base, answers: [answer] }).success).toBe(
			false
		)
	})

	it("refuses an empty response and a timestamp with no offset", () => {
		expect(PisoCampSurveyResponseSchema.safeParse({ ...base, answers: [] }).success).toBe(false)
		expect(
			PisoCampSurveyResponseSchema.safeParse({ ...base, submittedAt: "2026-09-02T04:05:06" })
				.success
		).toBe(false)
	})

	it("refuses a response id that is not a v4 UUID", () => {
		// The id is the server's primary key and the client mints it, so its
		// shape is the one thing a device cannot be sloppy about.
		expect(
			PisoCampSurveyResponseSchema.safeParse({ ...base, responseId: "response-1" }).success
		).toBe(false)
	})
})

describe("IngestSurveyResponsesInputSchema", () => {
	it("takes a batch and rejects an empty one", () => {
		expect(IngestSurveyResponsesInputSchema.safeParse({ responses: [base] }).success).toBe(true)
		expect(IngestSurveyResponsesInputSchema.safeParse({ responses: [] }).success).toBe(false)
	})

	it("caps the batch", () => {
		const responses = Array.from({ length: MAX_SURVEY_RESPONSE_BATCH + 1 }, (_value, index) => ({
			...base,
			responseId: `7c1f9a2e-3b4d-4e5f-8a6b-${index.toString().padStart(12, "0")}`,
		}))
		expect(IngestSurveyResponsesInputSchema.safeParse({ responses }).success).toBe(false)
	})

	it("refuses a repeated response id, which would make the batch ambiguous", () => {
		const result = IngestSurveyResponsesInputSchema.safeParse({ responses: [base, base] })

		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["responses", 1, "responseId"])
	})
})
