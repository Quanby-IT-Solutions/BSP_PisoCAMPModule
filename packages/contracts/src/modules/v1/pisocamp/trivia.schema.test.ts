import { describe, expect, it } from "vitest"

import {
	IngestTriviaResponsesInputSchema,
	MAX_TRIVIA_RESPONSE_BATCH,
	PisoCampTriviaResponseSchema,
	TRIVIA_POINTS,
} from "./trivia.schema.js"

const base = {
	responseId: "8e2a4a6c-6d0b-4a1a-9d1e-7a4f1b2c3d4e",
	contentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
	contentVersionId: "0d5b0a3f-1c88-4f27-8f0e-2d0d0a6f9b74",
	category: "security-features",
	difficulty: "easy" as const,
	correct: true,
	skipped: false,
	linkOpened: false,
	points: 1,
	answeredAt: "2026-09-02T04:05:06.000Z",
}

const skipped = {
	...base,
	responseId: "1c9a7e2b-4f5d-4c3b-8a2e-9f0d1b2c3a4d",
	correct: false,
	skipped: true,
	points: 0,
}

describe("PisoCampTriviaResponseSchema", () => {
	it("accepts a correct answer, a wrong answer with a link, and a skip", () => {
		expect(PisoCampTriviaResponseSchema.safeParse(base).success).toBe(true)
		expect(
			PisoCampTriviaResponseSchema.safeParse({
				...base,
				correct: false,
				points: 0,
				linkOpened: true,
			}).success
		).toBe(true)
		expect(PisoCampTriviaResponseSchema.safeParse(skipped).success).toBe(true)
	})

	it("scores a correct answer by difficulty", () => {
		expect(TRIVIA_POINTS).toEqual({ easy: 1, medium: 2, hard: 3 })
	})

	it.each([
		["a skipped question that scored", { ...skipped, points: 1 }],
		["a skipped question marked correct", { ...skipped, correct: true, points: 1 }],
		["a skipped question that opened a link", { ...skipped, linkOpened: true }],
		["a correct answer offered a link", { ...base, linkOpened: true }],
		["a correct answer worth nothing", { ...base, points: 0 }],
		["a wrong answer that scored", { ...base, correct: false }],
		["an unknown difficulty", { ...base, difficulty: "impossible" }],
		["a category that is not a catalog code", { ...base, category: "Security Features" }],
		["a response id that is not a v4 UUID", { ...base, responseId: "not-a-uuid" }],
		["a timestamp with no offset", { ...base, answeredAt: "2026-09-02T04:05:06" }],
		["an unknown field", { ...base, deviceId: "extra" }],
	])("rejects %s", (_label, candidate) => {
		expect(PisoCampTriviaResponseSchema.safeParse(candidate).success).toBe(false)
	})
})

describe("IngestTriviaResponsesInputSchema", () => {
	it("takes a batch of responses", () => {
		expect(
			IngestTriviaResponsesInputSchema.safeParse({ responses: [base, skipped] }).success
		).toBe(true)
	})

	it("rejects an empty batch", () => {
		expect(IngestTriviaResponsesInputSchema.safeParse({ responses: [] }).success).toBe(false)
	})

	it("rejects a batch over the limit", () => {
		const responses = Array.from({ length: MAX_TRIVIA_RESPONSE_BATCH + 1 }, (_value, index) => ({
			...base,
			responseId: `8e2a4a6c-6d0b-4a1a-9d1e-${index.toString().padStart(12, "0")}`,
		}))
		expect(IngestTriviaResponsesInputSchema.safeParse({ responses }).success).toBe(false)
	})

	it("rejects a repeated response id, which would make the batch ambiguous", () => {
		// The id is the idempotency key, so two rows claiming it in one batch is
		// a client bug rather than something to silently resolve.
		const result = IngestTriviaResponsesInputSchema.safeParse({
			responses: [base, { ...base, points: 1 }],
		})

		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["responses", 1, "responseId"])
	})
})
