import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

export const DEMOGRAPHIC_DIMENSIONS = ["ageGroup", "gender", "region", "city"] as const
export const DemographicDimensionSchema = z.enum(DEMOGRAPHIC_DIMENSIONS)

/**
 * One row of a demographic cut, which may be withheld.
 *
 * §4.2-I asks for the breakdown and §4.2-J forbids identifying anybody in it.
 * A small group does both at once, so a suppressed row keeps its label and
 * loses its figures: saying "fewer than 10" is the finding, and dropping the
 * row would instead read as nobody at all.
 */
export const DemographicBucketSchema = z
	.object({
		key: z.string(),
		label: z.string(),
		suppressed: z.boolean(),
		/** Null when suppressed. */
		users: NonNegativeInt.nullable(),
		percent: Ratio.nullable(),
	})
	.strict()

export const DemographicDistributionSchema = z
	.object({
		dimension: DemographicDimensionSchema,
		buckets: z.array(DemographicBucketSchema),
		/** People counted in the cut, before suppression hides any of them. */
		totalUsers: NonNegativeInt,
		/** How many buckets were withheld for being too small. */
		suppressedBuckets: NonNegativeInt,
	})
	.strict()

/** A measure cut by a dimension: DAU, average session, retention or churn. */
export const DemographicMeasureRowSchema = z
	.object({
		key: z.string(),
		label: z.string(),
		suppressed: z.boolean(),
		users: NonNegativeInt.nullable(),
		value: z.number().nullable(),
	})
	.strict()

export const DemographicMeasureSchema = z
	.object({
		dimension: DemographicDimensionSchema,
		/** What the value means, so a screen never has to guess a unit. */
		unit: z.enum(["users", "seconds", "percent"]),
		rows: z.array(DemographicMeasureRowSchema),
		suppressedRows: NonNegativeInt,
	})
	.strict()

export const DemographicsSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** The configured floor a group must reach to be reported at all. */
		suppressionMinimum: z.number().int().min(1),
		/** Profiles carrying a granted demographic-analytics consent. */
		consentedUsers: NonNegativeInt,
		/**
		 * Registered accounts with a profile but no such consent.
		 *
		 * Reported so a reader can see how much of the population the cuts leave
		 * out, without any of those people appearing in a cut.
		 */
		withoutConsentUsers: NonNegativeInt,
		distributions: z.array(DemographicDistributionSchema),
		/** Daily active users by gender, over the range. */
		dauByGender: DemographicMeasureSchema,
		/** Mean session length in seconds by gender. */
		sessionDurationByGender: DemographicMeasureSchema,
		/** Day-7 retention by each dimension. */
		retention: z.array(DemographicMeasureSchema),
		/** Churn by region and by city. */
		churn: z.array(DemographicMeasureSchema),
	})
	.strict()

/**
 * §4.2-M's drill-down: the rows behind a cut, for somebody explicitly
 * authorised to see them.
 *
 * Deliberately its own endpoint rather than a field on the summary: row-level
 * data should be unreachable without `reports.pii.view`, and a field that is
 * sometimes present is a field that can be forgotten.
 */
export const DemographicDrilldownInputSchema = EngagementRangeInputSchema.extend({
	dimension: DemographicDimensionSchema,
	/** Which bucket to open, as its key in the distribution. */
	bucketKey: z.string().trim().min(1).max(64),
	limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict()

export const DemographicDrilldownRowSchema = z
	.object({
		accountId: z.string(),
		name: z.string(),
		email: z.string(),
		gender: z.enum(["female", "male", "prefer_not_to_say"]),
		age: z.number().int(),
		regionCode: z.string(),
		cityCode: z.string(),
		activeDays: NonNegativeInt,
		lastActiveDate: z.iso.date().nullable(),
	})
	.strict()

export const DemographicDrilldownSchema = z
	.object({
		dimension: DemographicDimensionSchema,
		bucketKey: z.string(),
		from: z.iso.date(),
		to: z.iso.date(),
		rows: z.array(DemographicDrilldownRowSchema),
		/** People in the bucket, which may exceed the rows returned. */
		totalUsers: NonNegativeInt,
	})
	.strict()

export const DemographicsRangeInputSchema = EngagementRangeInputSchema

export type DemographicDimension = z.infer<typeof DemographicDimensionSchema>
export type DemographicBucket = z.infer<typeof DemographicBucketSchema>
export type DemographicDistribution = z.infer<typeof DemographicDistributionSchema>
export type DemographicMeasure = z.infer<typeof DemographicMeasureSchema>
export type DemographicsSummary = z.infer<typeof DemographicsSummarySchema>
export type DemographicDrilldownInput = z.infer<typeof DemographicDrilldownInputSchema>
export type DemographicDrilldown = z.infer<typeof DemographicDrilldownSchema>
