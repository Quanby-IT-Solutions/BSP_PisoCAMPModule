import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()

export const STORE_SOURCES = ["google_play", "app_store"] as const
export const StoreSourceSchema = z.enum(STORE_SOURCES)

/** A store's own figures for a period, as imported. */
export const StoreMetricSchema = z
	.object({
		source: StoreSourceSchema,
		installs: NonNegativeInt,
		uninstalls: NonNegativeInt,
		/** Null when the store reported no rating for the period. */
		ratingAverage: z.number().min(1).max(5).nullable(),
		ratingCount: NonNegativeInt.nullable(),
		periods: NonNegativeInt,
	})
	.strict()

/**
 * AN-001. How many installs, and where the number came from.
 *
 * The two sources count different things: a store counts downloads, and
 * `first_open` counts devices that actually opened the module. Adding them
 * would double-count every install that was opened, so they are reported side
 * by side and the headline names which one it is.
 */
export const InstallVolumeSchema = z
	.object({
		/** Distinct devices that reported opening the module for the first time. */
		firstOpenDevices: NonNegativeInt,
		storeInstalls: NonNegativeInt,
		storeUninstalls: NonNegativeInt,
		/** Which figure the headline uses, and null when there is neither. */
		headlineSource: z.enum(["store", "in_app"]).nullable(),
		headlineInstalls: NonNegativeInt.nullable(),
		/** Named so a reader always knows what they are looking at. */
		sourceLabel: z.string(),
	})
	.strict()

/**
 * AN-018. Store ratings beside the in-app ones.
 *
 * The combined average is weighted by how many ratings each side has, because
 * an average of two averages would let ten store ratings outweigh a thousand
 * in-app ones.
 */
export const RatingConsolidationSchema = z
	.object({
		inAppAverage: z.number().min(0).max(5).nullable(),
		inAppResponses: NonNegativeInt,
		storeAverage: z.number().min(1).max(5).nullable(),
		storeRatings: NonNegativeInt,
		combinedAverage: z.number().min(0).max(5).nullable(),
		combinedRatings: NonNegativeInt,
	})
	.strict()

export const AcquisitionSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		installVolume: InstallVolumeSchema,
		stores: z.array(StoreMetricSchema),
		ratings: RatingConsolidationSchema,
		/** False when no store has been imported for the range. */
		storeDataAvailable: z.boolean(),
	})
	.strict()

/** The §12 import: one store's figures for one period. */
export const ImportStoreMetricsInputSchema = z
	.object({
		rows: z
			.array(
				z
					.object({
						source: StoreSourceSchema,
						periodStart: z.iso.date(),
						periodEnd: z.iso.date(),
						installs: NonNegativeInt,
						uninstalls: NonNegativeInt.default(0),
						ratingAverage: z.number().min(1).max(5).nullable().default(null),
						ratingCount: NonNegativeInt.nullable().default(null),
					})
					.strict()
					.refine(row => row.periodStart <= row.periodEnd, {
						message: "The period must start on or before it ends",
						path: ["periodEnd"],
					})
					.refine(
						row =>
							(row.ratingAverage === null && row.ratingCount === null) ||
							(row.ratingAverage !== null && (row.ratingCount ?? 0) > 0),
						{
							message: "A rating needs both an average and a count",
							path: ["ratingCount"],
						}
					)
			)
			.min(1)
			.max(200),
	})
	.strict()

export const ImportStoreMetricsOutputSchema = z
	.object({
		imported: NonNegativeInt,
		/** Periods that already existed and were replaced rather than added to. */
		replaced: NonNegativeInt,
	})
	.strict()

export const AcquisitionRangeInputSchema = EngagementRangeInputSchema

export type StoreSource = z.infer<typeof StoreSourceSchema>
export type StoreMetric = z.infer<typeof StoreMetricSchema>
export type InstallVolume = z.infer<typeof InstallVolumeSchema>
export type RatingConsolidation = z.infer<typeof RatingConsolidationSchema>
export type AcquisitionSummary = z.infer<typeof AcquisitionSummarySchema>
export type ImportStoreMetricsInput = z.infer<typeof ImportStoreMetricsInputSchema>
