import { z } from "zod"

import { ConsentPurposeSchema, PisoCampGenderSchema } from "./pisocamp.schema.js"

/**
 * SA-7. Everything Piso CAMP holds about one person, in one document.
 *
 * Every section carries its own line of documentation, because an export
 * somebody cannot read is not an answer to "what do you have about me". The
 * shape is JSON rather than a rendered page: the point of a data-subject export
 * is that it can be taken somewhere else, and a document nobody can parse is a
 * picture of an answer.
 */
export const DataSubjectExportSchema = z
	.object({
		documentation: z
			.object({
				about: z.string().min(1),
				profile: z.string().min(1),
				consents: z.string().min(1),
				surveyResponses: z.string().min(1),
				triviaResponses: z.string().min(1),
				analytics: z.string().min(1),
			})
			.strict(),
		generatedAt: z.iso.datetime(),
		account: z
			.object({
				id: z.string().min(1),
				name: z.string(),
				email: z.email(),
				status: z.enum(["active", "deactivated"]),
			})
			.strict(),
		profile: z
			.object({
				gender: PisoCampGenderSchema,
				age: z.number().int(),
				regionCode: z.string(),
				cityCode: z.string(),
			})
			.strict()
			.nullable(),
		consents: z.array(
			z
				.object({
					purpose: ConsentPurposeSchema,
					decision: z.string(),
					noticeVersion: z.string(),
					respondedAt: z.iso.datetime(),
				})
				.strict()
		),
		surveyResponses: z.array(
			z
				.object({
					responseId: z.uuid(),
					submittedAt: z.iso.datetime(),
					answers: z.array(z.object({ questionId: z.uuid(), value: z.string() }).strict()),
				})
				.strict()
		),
		triviaResponses: z.array(
			z
				.object({
					responseId: z.uuid(),
					contentItemId: z.uuid(),
					category: z.string(),
					correct: z.boolean(),
					skipped: z.boolean(),
					answeredAt: z.iso.datetime(),
				})
				.strict()
		),
	})
	.strict()

export const DeletePisoCampSubjectDataInputSchema = z
	.object({
		accountId: z.string().min(1),
		/** The BSP process reference that approved this deletion. */
		approvalReference: z.string().min(1).max(200),
	})
	.strict()

/**
 * What a deletion actually did.
 *
 * Counted rather than assumed: "we deleted your data" is a claim somebody has
 * to be able to check, and the numbers are what the audit entry carries.
 */
export const DeletePisoCampSubjectDataOutputSchema = z
	.object({
		accountId: z.string().min(1),
		profileDeleted: z.boolean(),
		deviceLinksRemoved: z.number().int().nonnegative(),
		sessionsEnded: z.number().int().nonnegative(),
		/** A survey response can exist without a person, so it is kept and unlinked. */
		surveyResponsesPseudonymised: z.number().int().nonnegative(),
		/**
		 * A trivia response cannot: GM-3 keys it to an account and SA-7 does not
		 * rewrite another ticket's schema, so these are deleted rather than
		 * unlinked. The pseudonymous analytics events for the same activity stay.
		 */
		triviaResponsesDeleted: z.number().int().nonnegative(),
		consentRecordsRetained: z.number().int().nonnegative(),
	})
	.strict()

export type DataSubjectExport = z.infer<typeof DataSubjectExportSchema>
export type DeletePisoCampSubjectDataInput = z.infer<
	typeof DeletePisoCampSubjectDataInputSchema
>
export type DeletePisoCampSubjectDataOutput = z.infer<
	typeof DeletePisoCampSubjectDataOutputSchema
>
