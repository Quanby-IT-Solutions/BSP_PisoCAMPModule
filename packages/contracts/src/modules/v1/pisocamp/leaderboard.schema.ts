import { z } from "zod"

/**
 * The periods a leaderboard can cover.
 *
 * All three, because they answer different questions: this week is "am I
 * keeping up", this month is "am I improving", and all time is "how far have I
 * come". A board with only one of them motivates only the people already at the
 * top of it.
 */
export const LEADERBOARD_PERIODS = ["weekly", "monthly", "all_time"] as const
export const LeaderboardPeriodSchema = z.enum(LEADERBOARD_PERIODS)
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriodSchema>

/**
 * One row of the board.
 *
 * The alias and nothing else. A leaderboard that fell back to a real name or an
 * address would publish exactly what this module is careful never to publish,
 * and "it was only shown to other users" is not a defence.
 */
export const LeaderboardStandingSchema = z
	.object({
		rank: z.number().int().min(1),
		alias: z.string().min(1).max(40),
		score: z.number().int().nonnegative(),
		/**
		 * Places gained since the previous period of the same kind. Null when
		 * there was no previous period to compare with — which is not the same as
		 * having held station.
		 */
		rankMovement: z.number().int().nullable(),
	})
	.strict()

export const LeaderboardInputSchema = z
	.object({ period: LeaderboardPeriodSchema.default("weekly") })
	.strict()

export const LeaderboardSchema = z
	.object({
		period: LeaderboardPeriodSchema,
		/** The Asia/Manila day the period began. */
		periodStart: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** The top of the board, by alias. */
		top: z.array(LeaderboardStandingSchema).max(100),
		/**
		 * Where the person asking stands, even when they are not in the top.
		 * Null when they have scored nothing in this period yet.
		 */
		you: LeaderboardStandingSchema.nullable(),
	})
	.strict()

export const UpdateLeaderboardAliasInputSchema = z
	.object({
		alias: z
			.string()
			.min(3)
			.max(40)
			// Letters, digits, spaces, hyphens: enough to be somebody, not enough
			// to be an email address or a sentence.
			.regex(/^[A-Za-z0-9][A-Za-z0-9 \-_]*$/, "Use letters, digits, spaces or hyphens"),
	})
	.strict()

export type LeaderboardStanding = z.infer<typeof LeaderboardStandingSchema>
export type Leaderboard = z.infer<typeof LeaderboardSchema>
export type UpdateLeaderboardAliasInput = z.infer<typeof UpdateLeaderboardAliasInputSchema>
