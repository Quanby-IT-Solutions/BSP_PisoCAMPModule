import { z } from "zod"

/**
 * The window a dashboard asks about.
 *
 * Dates rather than timestamps, because every engagement figure here is a
 * count of Asia/Manila days and a half-day would not be one.
 */
export const EngagementRangeInputSchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
	})
	.strict()
	.refine(range => range.from <= range.to, {
		message: "The range must start on or before it ends",
		path: ["from"],
	})
	.refine(
		range => {
			const days =
				(Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) /
				86_400_000
			return days <= 366
		},
		{ message: "A range may not exceed 366 days", path: ["to"] }
	)

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

/** Active subjects on one Asia/Manila day. */
export const DailyActiveSchema = z
	.object({ date: z.iso.date(), activeUsers: NonNegativeInt })
	.strict()

/** How busy each hour of the day is, summed over the range. */
export const HourlyActivitySchema = z
	.object({ hour: z.number().int().min(0).max(23), sessions: NonNegativeInt })
	.strict()

/**
 * The busiest five-minute interval, and how many sessions overlapped it.
 *
 * Concurrency is the count of sessions **open** during the interval, which is
 * not the same as the count that started in it.
 */
export const ConcurrencyPeakSchema = z
	.object({ intervalStart: z.iso.datetime(), sessions: NonNegativeInt })
	.strict()

export const EngagementSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** How long a gap ends a session, as configured. */
		sessionInactivityMinutes: z.number().int().min(1).max(1440),
		/** Distinct subjects on the last day of the range. */
		dau: NonNegativeInt,
		/** Distinct subjects over the rolling 30 days ending on `to`. */
		mau: NonNegativeInt,
		/** DAU as a percentage of MAU. Zero when there is no MAU to divide by. */
		dauMauPercent: Ratio,
		sessions: NonNegativeInt,
		activeUsers: NonNegativeInt,
		sessionsPerUser: z.number().nonnegative(),
		averageSessionSeconds: z.number().nonnegative(),
		screenViewsPerSession: z.number().nonnegative(),
		dailyActive: z.array(DailyActiveSchema).max(366),
		hourly: z.array(HourlyActivitySchema).length(24),
		peakConcurrency: ConcurrencyPeakSchema.nullable(),
	})
	.strict()

export type EngagementRangeInput = z.infer<typeof EngagementRangeInputSchema>
export type EngagementSummary = z.infer<typeof EngagementSummarySchema>
export type DailyActive = z.infer<typeof DailyActiveSchema>
export type HourlyActivity = z.infer<typeof HourlyActivitySchema>
