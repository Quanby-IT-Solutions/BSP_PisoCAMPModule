import { z } from "zod"

/**
 * The largest a published model may be.
 *
 * Not a preference: the bundle's core entries are capped at the same figure on
 * the device, which reads and digests each object whole. A model that cannot
 * travel in the bundle cannot reach anybody.
 */
export const RECOGNITION_MODEL_MAX_BYTES = 5_242_880

/** How a published model version is named. */
export const RecognitionModelVersionSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

const LabelSchema = z.string().trim().min(1).max(64)
const DenominationCodeSchema = z.string().trim().min(1).max(32)

/**
 * One class the model can emit, and what it is allowed to claim.
 *
 * The shapes are the point (DR-3). A `demonetized` class cannot carry a
 * denomination and a `foreign` class cannot carry a label, so a wrong claim has
 * nowhere to live — on the server that accepts the model, in the descriptor
 * that travels to the device, and in the device that reads it.
 */
export const RecognitionModelClassSchema = z.discriminatedUnion("outcome", [
	z
		.object({
			classId: z.number().int().min(0).max(4095),
			outcome: z.literal("denomination"),
			label: LabelSchema,
			denominationCode: DenominationCodeSchema,
		})
		.strict(),
	z
		.object({
			classId: z.number().int().min(0).max(4095),
			outcome: z.literal("demonetized"),
			// The series, e.g. "New Design Series". Never a denomination.
			label: LabelSchema,
		})
		.strict(),
	z
		.object({
			classId: z.number().int().min(0).max(4095),
			outcome: z.literal("foreign"),
			// Nothing. Which currency it is sits outside this module (§17), so
			// there is nowhere for a class list to answer it.
		})
		.strict(),
])

export type RecognitionModelClass = z.infer<typeof RecognitionModelClassSchema>

export const RecognitionModelClassListSchema = z
	.array(RecognitionModelClassSchema)
	.min(1)
	.max(512)
	.superRefine((classes, context) => {
		const seen = new Set<number>()
		for (const [index, entry] of classes.entries()) {
			if (seen.has(entry.classId)) {
				context.addIssue({
					code: "custom",
					message: "Class IDs must be unique within a model",
					path: [index, "classId"],
				})
			}
			seen.add(entry.classId)
		}
		if (!classes.some(entry => entry.outcome === "denomination")) {
			context.addIssue({
				code: "custom",
				// A model that can never name a note is not a denomination
				// recogniser, and publishing one would silently disable the feature.
				message: "A model must be able to recognise at least one denomination",
			})
		}
	})

/**
 * The confidence a reading needs, and how long the module keeps trying.
 *
 * Approved **with** a model, not separately: a threshold tuned against one set
 * of weights says nothing about another, and applying it to the wrong model is
 * how a recogniser starts naming notes it should have refused.
 */
export const RecognitionThresholdsSchema = z
	.object({
		confidence: z.number().min(0.5).max(1),
		dwellSeconds: z.number().int().min(1).max(60),
	})
	.strict()

export type RecognitionThresholds = z.infer<typeof RecognitionThresholdsSchema>

/** Accepts a JSON string, as a multipart field, or an already-parsed value. */
function jsonField<T extends z.ZodType>(schema: T) {
	return z.preprocess(value => {
		if (typeof value !== "string") return value
		try {
			return JSON.parse(value) as unknown
		} catch {
			// Handed back untouched so the schema below reports what is wrong with
			// it, rather than this throwing a parse error with no path.
			return value
		}
	}, schema)
}

export const PublishRecognitionModelInputSchema = z
	.object({
		file: z.file().min(1).max(RECOGNITION_MODEL_MAX_BYTES),
		version: RecognitionModelVersionSchema,
		classes: jsonField(RecognitionModelClassListSchema),
		thresholds: jsonField(RecognitionThresholdsSchema),
		requestId: z.uuid(),
	})
	.strict()

export const RecognitionModelSummarySchema = z
	.object({
		version: RecognitionModelVersionSchema,
		status: z.enum(["active", "retired"]),
		classCount: z.number().int().positive(),
		thresholds: RecognitionThresholdsSchema,
		weightsSha256: z.string().regex(/^[a-f0-9]{64}$/),
		weightsByteLength: z.number().int().positive(),
		publishedAt: z.iso.datetime({ offset: true }),
		retiredAt: z.iso.datetime({ offset: true }).nullable(),
	})
	.strict()

export const PublishRecognitionModelOutputSchema = z
	.object({ model: RecognitionModelSummarySchema })
	.strict()

export const ListRecognitionModelsOutputSchema = z
	.object({ models: z.array(RecognitionModelSummarySchema).max(200) })
	.strict()

export const UpdateRecognitionThresholdsInputSchema = z
	.object({
		version: RecognitionModelVersionSchema,
		thresholds: RecognitionThresholdsSchema,
		requestId: z.uuid(),
	})
	.strict()

/**
 * What the bundle carries to a device, and what the device reads back.
 *
 * The thresholds travel with the model because they were approved with it, and
 * the version travels so a device can say which model produced a reading.
 */
export const RecognitionModelDescriptorSchema = z
	.object({
		schemaVersion: z.literal(1),
		version: RecognitionModelVersionSchema,
		thresholds: RecognitionThresholdsSchema,
		classes: RecognitionModelClassListSchema,
	})
	.strict()

export type RecognitionModelDescriptor = z.infer<typeof RecognitionModelDescriptorSchema>
export type PublishRecognitionModelInput = z.infer<typeof PublishRecognitionModelInputSchema>
export type UpdateRecognitionThresholdsInput = z.infer<
	typeof UpdateRecognitionThresholdsInputSchema
>
export type RecognitionModelSummary = z.infer<typeof RecognitionModelSummarySchema>
