import { z } from "zod"

const NonNegativeInt = z.number().int().nonnegative()

/**
 * GM-5. What one person has done in the module, for that person.
 *
 * Everything here is a count of their own activity. Nobody else's numbers
 * appear, and no comparison is drawn: this screen answers "what have I done and
 * what is left", not "how do I compare".
 */
export const PisoCampProgressSchema = z
	.object({
		/** Distinct content items this person has opened. */
		topicsViewed: NonNegativeInt,
		/** Distinct trivia items they have answered, skipped or not. */
		topicsAnswered: NonNegativeInt,
		questionsAnswered: NonNegativeInt,
		questionsCorrect: NonNegativeInt,
		questionsSkipped: NonNegativeInt,
		/**
		 * Correct answers as a percentage of the ones actually answered.
		 * Skipped questions are not wrong answers, so they are not in the
		 * denominator. Zero when nothing has been answered.
		 */
		accuracyPercent: z.number().min(0).max(100),
		points: NonNegativeInt,
		/** When they last did anything. Null before they have. */
		lastActivityAt: z.iso.datetime().nullable(),
	})
	.strict()

export type PisoCampProgress = z.infer<typeof PisoCampProgressSchema>
