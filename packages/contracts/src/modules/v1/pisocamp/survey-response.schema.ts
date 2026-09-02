import { z } from "zod"

import { MAX_SURVEY_QUESTIONS } from "./content.schema.js"

const UuidV4Schema = z
	.string()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

const UtcTimestampSchema = z.iso.datetime({ offset: true })

const HTML_MARKUP_PATTERN = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>|<\?[\s\S]*?\?>/

/**
 * A written answer.
 *
 * Plain text, because it is shown back to a BSP reader in AN-6 and markup in a
 * free-text field is the oldest way to get script onto somebody else's screen.
 */
const AnswerTextSchema = z
	.string()
	.trim()
	.min(1)
	.max(1_000)
	.refine(value => !HTML_MARKUP_PATTERN.test(value), "HTML is not allowed")

/**
 * One answer.
 *
 * The three shapes are the three things a person can do with a question:
 * give it a score, write something, or leave an optional one alone. Which shape
 * a question accepts is decided by the question itself, and the server checks
 * the pair rather than trusting the client's word for it.
 */
export const PisoCampSurveyAnswerSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("scale"), questionId: z.uuid(), value: z.number().int().min(0).max(10) }).strict(),
	z.object({ kind: z.literal("text"), questionId: z.uuid(), value: AnswerTextSchema }).strict(),
	z.object({ kind: z.literal("skipped"), questionId: z.uuid() }).strict(),
])

/**
 * One completed survey.
 *
 * `responseId` is minted on the device and is the server's primary key, so a
 * response queued offline and re-sent lands once. `consentRecordId` names the
 * grant the answer was given under: no grant, no response.
 */
export const PisoCampSurveyResponseSchema = z
	.object({
		responseId: UuidV4Schema,
		contentItemId: z.uuid(),
		contentVersionId: z.uuid(),
		consentRecordId: z.uuid(),
		submittedAt: UtcTimestampSchema,
		answers: z.array(PisoCampSurveyAnswerSchema).min(1).max(MAX_SURVEY_QUESTIONS),
	})
	.strict()
	.superRefine((response, context) => {
		const seen = new Set<string>()
		for (const [index, answer] of response.answers.entries()) {
			if (seen.has(answer.questionId)) {
				context.addIssue({
					code: "custom",
					message: "A question is answered at most once",
					path: ["answers", index, "questionId"],
				})
			}
			seen.add(answer.questionId)
		}
	})

export const MAX_SURVEY_RESPONSE_BATCH = 20

export const IngestSurveyResponsesInputSchema = z
	.object({
		responses: z.array(PisoCampSurveyResponseSchema).min(1).max(MAX_SURVEY_RESPONSE_BATCH),
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
 * The ids the server now holds, so a device deletes exactly what landed and
 * keeps anything that did not.
 */
export const IngestSurveyResponsesOutputSchema = z
	.object({ ackedResponseIds: z.array(UuidV4Schema).max(MAX_SURVEY_RESPONSE_BATCH) })
	.strict()

export type PisoCampSurveyAnswer = z.infer<typeof PisoCampSurveyAnswerSchema>
export type PisoCampSurveyResponse = z.infer<typeof PisoCampSurveyResponseSchema>
export type IngestSurveyResponsesInput = z.infer<typeof IngestSurveyResponsesInputSchema>
export type IngestSurveyResponsesOutput = z.infer<typeof IngestSurveyResponsesOutputSchema>
