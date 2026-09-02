import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

/**
 * How many of a cohort came back on one particular day.
 *
 * Day N retention is activity **on** day N, not on or after it: "came back the
 * next day" and "came back at some point" are different questions, and only
 * the first is comparable between cohorts of different ages.
 */
export const RetentionPointSchema = z
	.object({ retainedUsers: NonNegativeInt, percent: Ratio })
	.strict()

/**
 * One cohort: everybody whose first ever activity fell on the same day.
 *
 * A day that has not elapsed yet reports **null**, not zero. A cohort formed
 * yesterday cannot have a 30-day retention figure, and printing 0% for one
 * would report a failure that has not had the chance to happen.
 */
export const CohortRetentionSchema = z
	.object({
		cohortDate: z.iso.date(),
		users: z.number().int().positive(),
		d1: RetentionPointSchema.nullable(),
		d7: RetentionPointSchema.nullable(),
		d30: RetentionPointSchema.nullable(),
	})
	.strict()

export const RetentionSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** The configured quiet period after which somebody counts as churned. */
		churnInactivityDays: z.number().int().min(1).max(365),
		/** One row per day in the range that started a cohort. */
		cohorts: z.array(CohortRetentionSchema).max(366),

		/** Everybody with any qualifying activity on or before `to`. */
		knownUsers: NonNegativeInt,
		/** Of those, the ones quiet for longer than the inactivity period. */
		churnedUsers: NonNegativeInt,
		churnRatePercent: Ratio,

		/** Quiet at the range start, but not yet long enough to have churned. */
		lapsedAtRangeStart: NonNegativeInt,
		reengagedUsers: NonNegativeInt,
		reengagementRatePercent: Ratio,

		/** Already churned at the range start. */
		churnedAtRangeStart: NonNegativeInt,
		reactivatedUsers: NonNegativeInt,
		reactivationRatePercent: Ratio,

		/**
		 * Last qualifying activity minus first, in whole days.
		 *
		 * Null rather than zero when nobody is known yet: "no users" and "every
		 * user lasted a day" are different facts.
		 */
		averageLifetimeDays: z.number().nonnegative().nullable(),
		medianLifetimeDays: z.number().nonnegative().nullable(),
	})
	.strict()

export const RetentionRangeInputSchema = EngagementRangeInputSchema

export type RetentionPoint = z.infer<typeof RetentionPointSchema>
export type CohortRetention = z.infer<typeof CohortRetentionSchema>
export type RetentionSummary = z.infer<typeof RetentionSummarySchema>
