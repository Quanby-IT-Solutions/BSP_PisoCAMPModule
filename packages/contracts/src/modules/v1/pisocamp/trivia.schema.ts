import { z } from "zod"

/** How many points a correct answer is worth, by difficulty. */
export const TRIVIA_POINTS = { easy: 1, medium: 2, hard: 3 } as const

const UuidV4Schema = z
	.string()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

const CatalogCodeSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const UtcTimestampSchema = z.iso.datetime({ offset: true })

/**
 * One recorded presentation and its outcome.
 *
 * `responseId` is chosen by the client and is the row's primary key, so a
 * re-uploaded batch does nothing rather than counting an answer twice.
 */
export const PisoCampTriviaResponseSchema = z
	.object({
		responseId: UuidV4Schema,
		contentItemId: z.uuid(),
		contentVersionId: z.uuid(),
		category: CatalogCodeSchema,
		difficulty: z.enum(["easy", "medium", "hard"]),
		correct: z.boolean(),
		skipped: z.boolean(),
		linkOpened: z.boolean(),
		points: z.number().int().min(0).max(100),
		answeredAt: UtcTimestampSchema,
	})
	.strict()
	.superRefine((response, context) => {
		if (response.skipped && (response.correct || response.points > 0 || response.linkOpened)) {
			context.addIssue({
				code: "custom",
				message: "A skipped question was not answered",
				path: ["skipped"],
			})
		}
		if (response.correct && response.linkOpened) {
			context.addIssue({
				code: "custom",
				message: "Only an incorrect answer is offered a link",
				path: ["linkOpened"],
			})
		}
		if (response.correct !== response.points > 0) {
			context.addIssue({
				code: "custom",
				message: "Points are awarded for a correct answer and only for one",
				path: ["points"],
			})
		}
	})

export const MAX_TRIVIA_RESPONSE_BATCH = 100

export const IngestTriviaResponsesInputSchema = z
	.object({
		responses: z.array(PisoCampTriviaResponseSchema).min(1).max(MAX_TRIVIA_RESPONSE_BATCH),
	})
	.strict()
	.superRefine(({ responses }, context) => {
		const seen = new Set<string>()
		for (const [index, response] of responses.entries()) {
			if (seen.has(response.responseId)) {
				context.addIssue({
					code: "custom",
					message: "Response IDs must be unique within a batch",
					path: ["responses", index, "responseId"],
				})
			}
			seen.add(response.responseId)
		}
	})

/**
 * The ids the server now holds.
 *
 * Acknowledgement rather than a count, so a client deletes exactly what landed
 * and keeps anything that did not.
 */
export const IngestTriviaResponsesOutputSchema = z
	.object({ ackedResponseIds: z.array(UuidV4Schema).max(MAX_TRIVIA_RESPONSE_BATCH) })
	.strict()

export type PisoCampTriviaResponse = z.infer<typeof PisoCampTriviaResponseSchema>
export type IngestTriviaResponsesInput = z.infer<typeof IngestTriviaResponsesInputSchema>
export type IngestTriviaResponsesOutput = z.infer<typeof IngestTriviaResponsesOutputSchema>
