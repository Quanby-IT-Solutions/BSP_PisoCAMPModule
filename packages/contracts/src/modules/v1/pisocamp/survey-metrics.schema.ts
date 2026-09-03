import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

/**
 * AN-018. How a scaled question was answered.
 *
 * The distribution carries **every** point on the question's scale, including
 * the ones nobody chose: a missing bar reads as a value that could not be
 * picked, which is a different claim from one nobody picked.
 */
export const ScaleDistributionPointSchema = z
	.object({
		value: z.number().int(),
		responses: NonNegativeInt,
		percent: Ratio,
	})
	.strict()

/**
 * AN-019. Net promoter score for an NPS question.
 *
 * `score` is percent promoters minus percent detractors, so it runs from -100
 * to 100 and is null when nobody answered — zero would mean the promoters and
 * the detractors cancelled out, which is not the same as silence.
 */
export const NpsBreakdownSchema = z
	.object({
		promoters: NonNegativeInt,
		passives: NonNegativeInt,
		detractors: NonNegativeInt,
		promoterPercent: Ratio,
		passivePercent: Ratio,
		detractorPercent: Ratio,
		score: z.number().min(-100).max(100).nullable(),
	})
	.strict()

export const SurveyQuestionMetricSchema = z
	.object({
		questionId: z.uuid(),
		position: z.number().int().nonnegative(),
		kind: z.enum(["rating", "nps", "text"]),
		prompt: z.string(),
		required: z.boolean(),
		answered: NonNegativeInt,
		skipped: NonNegativeInt,
		/** Mean of the scaled answers. Null for a text question or no answers. */
		average: z.number().nullable(),
		/** Empty for a text question, which has no scale to distribute over. */
		distribution: z.array(ScaleDistributionPointSchema),
		/** Present only on an NPS question. */
		nps: NpsBreakdownSchema.nullable(),
	})
	.strict()

/**
 * AN-020. Whether the consent behind the responses still stands.
 *
 * A withdrawn consent does not delete the response it covered, so the report
 * says how many of the responses it is built from rest on a grant somebody has
 * since taken back.
 */
export const SurveyConsentStatusSchema = z
	.object({
		granted: NonNegativeInt,
		withdrawn: NonNegativeInt,
	})
	.strict()

export const SurveyMetricSchema = z
	.object({
		contentItemId: z.uuid(),
		title: z.string(),
		/** Prompts shown and declines come from the events, not the responses. */
		promptsShown: NonNegativeInt,
		declined: NonNegativeInt,
		responses: NonNegativeInt,
		/** Responses ÷ prompts shown. Zero when nothing was shown. */
		completionRatePercent: Ratio,
		/** Mean over every rating question in the survey. Null when unanswered. */
		averageRating: z.number().nullable(),
		consent: SurveyConsentStatusSchema,
		questions: z.array(SurveyQuestionMetricSchema),
	})
	.strict()

export const SurveyMetricsSummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** Responses stored in the range, whatever survey they belong to. */
		totalResponses: NonNegativeInt,
		/** Mean over every rating answer in the range. Null when there are none. */
		overallAverageRating: z.number().nullable(),
		/** Over every NPS question in the range, taken together. */
		overallNps: NpsBreakdownSchema,
		consent: SurveyConsentStatusSchema,
		/**
		 * Store ratings arrive with AN-11; until then this says so rather than
		 * showing a consolidated figure that is only the in-app half.
		 */
		storeRatingsAvailable: z.boolean(),
		surveys: z.array(SurveyMetricSchema),
	})
	.strict()

export const SurveyMetricsRangeInputSchema = EngagementRangeInputSchema

export type ScaleDistributionPoint = z.infer<typeof ScaleDistributionPointSchema>
export type NpsBreakdown = z.infer<typeof NpsBreakdownSchema>
export type SurveyQuestionMetric = z.infer<typeof SurveyQuestionMetricSchema>
export type SurveyConsentStatus = z.infer<typeof SurveyConsentStatusSchema>
export type SurveyMetric = z.infer<typeof SurveyMetricSchema>
export type SurveyMetricsSummary = z.infer<typeof SurveyMetricsSummarySchema>
