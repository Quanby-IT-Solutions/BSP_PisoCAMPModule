import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, eq, inArray } from "drizzle-orm"

import {
	consentRecords,
	contentItems,
	surveyAnswers,
	surveyQuestions,
	surveyResponses,
} from "@repo/db/schema"

import {
	databaseTransactionContext,
	type DatabaseTransaction,
} from "@/common/database/database-transaction.context"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"
import type { ConsentSubject } from "@/modules/v1/pisocamp/pisocamp-consent.service"

type Input = V1Inputs["pisocamp"]["surveys"]["ingest"]
type Response = Input["responses"][number]

@Injectable()
export class SurveyResponseService {
	/**
	 * Stores consented survey responses, idempotently.
	 *
	 * Three things are checked before anything is written, and each of them is
	 * a thing a client could get wrong or lie about: the consent record is the
	 * subject's own, current and granted; the survey version exists; and every
	 * answer belongs to that version's questions and fits the kind of question
	 * it answers. A response that fails any of them is refused whole — a
	 * half-stored survey is not a survey anybody can report on.
	 */
	async ingest(subject: ConsentSubject, input: Input): Promise<V1Outputs["pisocamp"]["surveys"]["ingest"]> {
		const responseIds = input.responses.map(response => response.responseId)

		await databaseTransactionContext.transaction(async tx => {
			const held = await tx
				.select({
					responseId: surveyResponses.responseId,
					accountId: surveyResponses.accountId,
					devicePseudoId: surveyResponses.devicePseudoId,
				})
				.from(surveyResponses)
				.where(inArray(surveyResponses.responseId, responseIds))
			// An id already held by somebody else is not this subject's to claim,
			// and acknowledging it would report an answer that was never stored.
			if (held.some(row => !this.isSameSubject(row, subject))) {
				throw new ORPCError("CONFLICT", {
					message: "One or more responses are already recorded for another subject",
				})
			}
			const alreadyHeld = new Set(held.map(row => row.responseId))

			for (const response of input.responses) {
				if (alreadyHeld.has(response.responseId)) continue
				await this.assertConsented(tx, subject, response)
				const questions = await this.questionsFor(tx, response)
				this.assertAnswerable(response, questions)

				await tx.insert(surveyResponses).values({
					responseId: response.responseId,
					contentItemId: response.contentItemId,
					contentVersionId: response.contentVersionId,
					consentRecordId: response.consentRecordId,
					accountId: "accountId" in subject ? subject.accountId : null,
					devicePseudoId: "devicePseudoId" in subject ? subject.devicePseudoId : null,
					submittedAt: new Date(response.submittedAt),
				})
				await tx.insert(surveyAnswers).values(
					response.answers.map(answer => ({
						responseId: response.responseId,
						questionId: answer.questionId,
						scaleValue: answer.kind === "scale" ? answer.value : null,
						textValue: answer.kind === "text" ? answer.value : null,
						skipped: answer.kind === "skipped",
					}))
				)
			}
		})

		return { ackedResponseIds: responseIds }
	}

	private isSameSubject(
		row: { accountId: string | null; devicePseudoId: string | null },
		subject: ConsentSubject
	): boolean {
		return "accountId" in subject
			? row.accountId === subject.accountId
			: row.devicePseudoId === subject.devicePseudoId
	}

	/** The grant must be the subject's own, for surveys, and still granted. */
	private async assertConsented(
		tx: DatabaseTransaction,
		subject: ConsentSubject,
		response: Response
	): Promise<void> {
		const [record] = await tx
			.select({
				accountId: consentRecords.accountId,
				devicePseudoId: consentRecords.devicePseudoId,
				purpose: consentRecords.purpose,
				status: consentRecords.status,
			})
			.from(consentRecords)
			.where(eq(consentRecords.id, response.consentRecordId))

		if (!record || !this.isSameSubject(record, subject)) {
			throw new ORPCError("FORBIDDEN", {
				message: "The response names a consent record that is not yours",
			})
		}
		if (record.purpose !== "survey" || record.status !== "granted") {
			throw new ORPCError("FORBIDDEN", {
				message: "Survey responses require a current granted survey consent",
			})
		}
	}

	private async questionsFor(tx: DatabaseTransaction, response: Response) {
		const [item] = await tx
			.select({ contentType: contentItems.contentType })
			.from(contentItems)
			.where(eq(contentItems.id, response.contentItemId))
		if (item?.contentType !== "survey") {
			throw new ORPCError("BAD_REQUEST", { message: "The response does not name a survey" })
		}
		const questions = await tx
			.select({
				id: surveyQuestions.id,
				kind: surveyQuestions.kind,
				required: surveyQuestions.required,
				scaleMin: surveyQuestions.scaleMin,
				scaleMax: surveyQuestions.scaleMax,
			})
			.from(surveyQuestions)
			.where(
				and(
					eq(surveyQuestions.contentItemId, response.contentItemId),
					eq(surveyQuestions.contentVersionId, response.contentVersionId)
				)
			)
		if (!questions.length) {
			throw new ORPCError("BAD_REQUEST", { message: "Unknown survey version" })
		}
		return questions
	}

	private assertAnswerable(
		response: Response,
		questions: {
			id: string
			kind: "rating" | "nps" | "text"
			required: boolean
			scaleMin: number | null
			scaleMax: number | null
		}[]
	): void {
		const byId = new Map(questions.map(question => [question.id, question]))
		for (const answer of response.answers) {
			const question = byId.get(answer.questionId)
			if (!question) {
				throw new ORPCError("BAD_REQUEST", {
					message: "An answer names a question this survey version does not ask",
				})
			}
			if (answer.kind === "skipped") {
				// A required question with no answer is not a completed survey.
				if (question.required) {
					throw new ORPCError("BAD_REQUEST", { message: "A required question was not answered" })
				}
				continue
			}
			if (question.kind === "text") {
				if (answer.kind !== "text") {
					throw new ORPCError("BAD_REQUEST", { message: "A written question needs a written answer" })
				}
				continue
			}
			if (answer.kind !== "scale") {
				throw new ORPCError("BAD_REQUEST", { message: "A scaled question needs a score" })
			}
			// The bounds are the question's own, read from the row rather than
			// assumed, so a rating can never be scored 8 because NPS allows it.
			if (answer.value < (question.scaleMin ?? 0) || answer.value > (question.scaleMax ?? 0)) {
				throw new ORPCError("BAD_REQUEST", { message: "A score is outside the question's scale" })
			}
		}
		const answered = new Set(response.answers.map(answer => answer.questionId))
		if (questions.some(question => !answered.has(question.id))) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Every question of the survey must be answered or skipped",
			})
		}
	}
}

