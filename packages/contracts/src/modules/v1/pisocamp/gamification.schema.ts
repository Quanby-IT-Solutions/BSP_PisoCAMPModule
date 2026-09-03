import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

/**
 * AN-028. How many of the people who could take part in the leaderboard did.
 *
 * "Eligible" is every registered account, because the leaderboard is offered to
 * all of them; dividing by only the ones who already play would report a
 * participation rate that could never fall.
 */
export const LeaderboardParticipationSchema = z
	.object({
		eligibleUsers: NonNegativeInt,
		participatingUsers: NonNegativeInt,
		participationRatePercent: Ratio,
		/** How many went up, down, and held station since the previous period. */
		movedUp: NonNegativeInt,
		movedDown: NonNegativeInt,
		unchanged: NonNegativeInt,
		/** First appearances: nobody to compare them with yet. */
		newEntrants: NonNegativeInt,
	})
	.strict()

/**
 * AN-029. Whether the people at the top stay there.
 *
 * Retention of the top group, not of everybody: the question is whether
 * gamification holds the people it is working on.
 */
export const TopPerformerRetentionSchema = z
	.object({
		topGroupPercent: z.number().int().min(1).max(50),
		/** How many were in the top group in the previous period. */
		previousTopUsers: NonNegativeInt,
		/** How many of those are still in it. */
		retainedTopUsers: NonNegativeInt,
		retentionRatePercent: Ratio,
	})
	.strict()

/**
 * AN-030 / AN-031. What people did with the trivia they were shown.
 *
 * Viewed comes from the prompts shown; answered, skipped and correct from the
 * responses that were actually stored. Counting a shown prompt as an answer
 * would make the completion rate meaningless.
 */
export const TriviaParticipationSchema = z
	.object({
		promptsShown: NonNegativeInt,
		answered: NonNegativeInt,
		skipped: NonNegativeInt,
		correct: NonNegativeInt,
		incorrect: NonNegativeInt,
		/** Answered ÷ shown. Zero when nothing was shown. */
		completionRatePercent: Ratio,
		/** Right ÷ answered. Skips are not wrong answers. */
		accuracyPercent: Ratio,
		participants: NonNegativeInt,
		/** Participants who answered on more than one Asia/Manila day. */
		repeatParticipants: NonNegativeInt,
		repeatRatePercent: Ratio,
	})
	.strict()

/**
 * AN-032. Whether trivia sends people back to the learning content.
 *
 * A view, a related-link open or an engagement prompt **after** a trivia event
 * in the same session — after, because the point is whether the trivia caused
 * the return, and something that happened first cannot have.
 */
export const LearningReengagementSchema = z
	.object({
		sessionsWithTrivia: NonNegativeInt,
		sessionsReturningToContent: NonNegativeInt,
		reengagementRatePercent: Ratio,
		contentViewsAfterTrivia: NonNegativeInt,
		relatedLinkOpensAfterTrivia: NonNegativeInt,
		/**
		 * Engagement prompts shown after a trivia event. Counted and shown, but
		 * kept out of the rate: being asked to register is not a return to the
		 * learning content.
		 */
		engagementPromptsAfterTrivia: NonNegativeInt,
	})
	.strict()

export const GamificationSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** False when GM-4's flag is off; the leaderboard figures are then zero. */
		leaderboardEnabled: z.boolean(),
		participation: LeaderboardParticipationSchema,
		topPerformers: TopPerformerRetentionSchema,
		trivia: TriviaParticipationSchema,
		reengagement: LearningReengagementSchema,
	})
	.strict()

export const GamificationRangeInputSchema = EngagementRangeInputSchema

export type LeaderboardParticipation = z.infer<typeof LeaderboardParticipationSchema>
export type TopPerformerRetention = z.infer<typeof TopPerformerRetentionSchema>
export type TriviaParticipation = z.infer<typeof TriviaParticipationSchema>
export type LearningReengagement = z.infer<typeof LearningReengagementSchema>
export type GamificationSummary = z.infer<typeof GamificationSummarySchema>
