import { z } from "zod"

/**
 * When a survey may be offered, per Annex H EV-002.
 *
 * A closed list: a trigger the client does not know how to fire is a rule that
 * would silently never run, so an unknown one is refused rather than stored.
 */
export const SURVEY_TRIGGER_TYPES = [
	"page_depth",
	"activity_completion",
	"topic_completion",
	"module_exit",
	"app_exit",
] as const
export const PisoCampSurveyTriggerTypeSchema = z.enum(SURVEY_TRIGGER_TYPES)

/** 1 is the highest. Stated once, because "higher priority" reads both ways. */
export const SURVEY_TRIGGER_PRIORITY = { highest: 1, lowest: 100 } as const

const PageDepthSchema = z.number().int().min(1).max(50)
const FrequencyCapDaysSchema = z.number().int().min(1).max(365)
const PrioritySchema = z
	.number()
	.int()
	.min(SURVEY_TRIGGER_PRIORITY.highest)
	.max(SURVEY_TRIGGER_PRIORITY.lowest)

const TriggerRuleShape = {
	triggerType: PisoCampSurveyTriggerTypeSchema,
	/** Screens deep, and only meaningful for a page-depth trigger. */
	pageDepth: PageDepthSchema.nullish(),
	/** Days before the same survey may be offered again; null means no cap. */
	frequencyCapDays: FrequencyCapDaysSchema.nullish(),
	priority: PrioritySchema,
	enabled: z.boolean(),
}

function refineDepth(
	rule: { triggerType: string; pageDepth?: number | null },
	context: z.RefinementCtx
) {
	// A depth on a trigger that is not about depth is a number nobody reads,
	// and a page-depth trigger without one has nothing to fire on.
	const needsDepth = rule.triggerType === "page_depth"
	if (needsDepth && (rule.pageDepth ?? null) === null) {
		context.addIssue({
			code: "custom",
			message: "A page-depth trigger needs a depth",
			path: ["pageDepth"],
		})
	}
	if (!needsDepth && (rule.pageDepth ?? null) !== null) {
		context.addIssue({
			code: "custom",
			message: "Only a page-depth trigger carries a depth",
			path: ["pageDepth"],
		})
	}
}

export const UpsertPisoCampSurveyTriggerInputSchema = z
	.object({
		requestId: z.uuid(),
		contentItemId: z.uuid(),
		...TriggerRuleShape,
	})
	.strict()
	.superRefine(refineDepth)

export const PisoCampSurveyTriggerRuleSchema = z
	.object({
		id: z.uuid(),
		contentItemId: z.uuid(),
		surveyTitle: z.string().min(1).max(160),
		...TriggerRuleShape,
		pageDepth: PageDepthSchema.nullable(),
		frequencyCapDays: FrequencyCapDaysSchema.nullable(),
		updatedAt: z.iso.datetime(),
	})
	.strict()
	.superRefine(refineDepth)

export const ListPisoCampSurveyTriggersOutputSchema = z
	.object({ rules: z.array(PisoCampSurveyTriggerRuleSchema) })
	.strict()

export const DeletePisoCampSurveyTriggerInputSchema = z
	.object({
		requestId: z.uuid(),
		contentItemId: z.uuid(),
		triggerType: PisoCampSurveyTriggerTypeSchema,
	})
	.strict()

export const DeletePisoCampSurveyTriggerOutputSchema = z
	.object({ deleted: z.boolean() })
	.strict()

/**
 * A rule as a device sees it, carried in the public configuration.
 *
 * No title, no timestamps, no authorship: a device needs to know when to ask
 * and which survey wins, and nothing else about who arranged it.
 */
export const PisoCampSurveyTriggerConfigSchema = z
	.object({
		contentItemId: z.uuid(),
		triggerType: PisoCampSurveyTriggerTypeSchema,
		pageDepth: PageDepthSchema.nullable(),
		frequencyCapDays: FrequencyCapDaysSchema.nullable(),
		priority: PrioritySchema,
	})
	.strict()

export type PisoCampSurveyTriggerType = z.infer<typeof PisoCampSurveyTriggerTypeSchema>
export type PisoCampSurveyTriggerRule = z.infer<typeof PisoCampSurveyTriggerRuleSchema>
export type PisoCampSurveyTriggerConfig = z.infer<typeof PisoCampSurveyTriggerConfigSchema>
export type UpsertPisoCampSurveyTriggerInput = z.infer<
	typeof UpsertPisoCampSurveyTriggerInputSchema
>
export type DeletePisoCampSurveyTriggerInput = z.infer<
	typeof DeletePisoCampSurveyTriggerInputSchema
>
export type ListPisoCampSurveyTriggersOutput = z.infer<
	typeof ListPisoCampSurveyTriggersOutputSchema
>
