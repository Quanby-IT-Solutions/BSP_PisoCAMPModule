import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq, inArray } from "drizzle-orm"

import type {
	DataSubjectExport,
	DeletePisoCampSubjectDataInput,
	DeletePisoCampSubjectDataOutput,
} from "@repo/contracts/pisocamp-data-subject"
import {
	consentRecords,
	pisoCampAccountState,
	pisoCampDeviceAccountLinks,
	pisoCampProfiles,
	sessions,
	surveyAnswers,
	surveyResponses,
	triviaResponses,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

/** The lines that make the export readable without a schema to hand. */
const DOCUMENTATION = {
	about:
		"Everything the Piso CAMP module holds that is linked to your account, as of the time given below.",
	profile:
		"The demographic details you gave when registering. Absent if you never completed a profile.",
	consents:
		"Every consent decision you have recorded, including withdrawals, and which version of the privacy notice each answered.",
	surveyResponses: "The survey answers you submitted while signed in.",
	triviaResponses: "The trivia answers you submitted while signed in.",
	analytics:
		"Usage analytics are not listed here: they are recorded against a device pseudonym that is never linked back to your account, so there is nothing in them to give you.",
} as const

@Injectable()
export class PisoCampDataSubjectService {
	constructor(private readonly auditService: AuditService) {}

	/**
	 * Everything held about one person, for that person.
	 *
	 * No administrator is involved and no permission is required beyond being
	 * signed in: it is their data, and a right you have to ask somebody else to
	 * exercise for you is a weaker right.
	 */
	async exportFor(accountId: string): Promise<DataSubjectExport> {
		const [account] = await db
			.select({ id: users.id, name: users.name, email: users.email })
			.from(users)
			.where(eq(users.id, accountId))
		if (!account) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

		const [state] = await db
			.select({ status: pisoCampAccountState.status })
			.from(pisoCampAccountState)
			.where(eq(pisoCampAccountState.accountId, accountId))

		const [profile] = await db
			.select()
			.from(pisoCampProfiles)
			.where(eq(pisoCampProfiles.accountId, accountId))

		const consents = await db
			.select()
			.from(consentRecords)
			.where(eq(consentRecords.accountId, accountId))
			.orderBy(consentRecords.recordedAt)

		const responses = await db
			.select()
			.from(surveyResponses)
			.where(eq(surveyResponses.accountId, accountId))
			.orderBy(surveyResponses.submittedAt)

		const answers =
			responses.length === 0
				? []
				: await db
						.select()
						.from(surveyAnswers)
						.where(
							inArray(
								surveyAnswers.responseId,
								responses.map(response => response.responseId)
							)
						)

		const trivia = await db
			.select()
			.from(triviaResponses)
			.where(eq(triviaResponses.accountId, accountId))
			.orderBy(triviaResponses.answeredAt)

		const answersByResponse = new Map<string, typeof answers>()
		for (const answer of answers) {
			const list = answersByResponse.get(answer.responseId) ?? []
			list.push(answer)
			answersByResponse.set(answer.responseId, list)
		}

		return {
			documentation: { ...DOCUMENTATION },
			generatedAt: new Date().toISOString(),
			account: {
				id: account.id,
				name: account.name,
				email: account.email,
				status: state?.status === "deactivated" ? "deactivated" : "active",
			},
			profile: profile
				? {
						gender: profile.gender,
						age: profile.age,
						regionCode: profile.regionCode,
						cityCode: profile.cityCode,
					}
				: null,
			consents: consents.map(record => ({
				purpose: record.purpose,
				decision: record.status,
				noticeVersion: record.noticeVersion,
				respondedAt: record.respondedAt.toISOString(),
			})),
			surveyResponses: responses.map(response => ({
				responseId: response.responseId,
				submittedAt: response.submittedAt.toISOString(),
				answers: (answersByResponse.get(response.responseId) ?? []).map(answer => ({
					questionId: answer.questionId,
					// Whichever kind of answer it was, in words rather than columns.
					value: answer.skipped
						? "skipped"
						: (answer.textValue ?? String(answer.scaleValue ?? "")),
				})),
			})),
			triviaResponses: trivia.map(response => ({
				responseId: response.responseId,
				contentItemId: response.contentItemId,
				category: response.category,
				correct: response.correct,
				skipped: response.skipped,
				answeredAt: response.answeredAt.toISOString(),
			})),
		}
	}

	/**
	 * Delete or pseudonymise one person's data, keeping what must be kept.
	 *
	 * Three things survive on purpose, and each for a different reason:
	 *
	 *  - **The account row**, with its name and address replaced. Deleting it
	 *    would take the audit trail's actor with it, and an audit entry that
	 *    cannot say who acted is not evidence.
	 *  - **Consent records**, which are the proof that collection was lawful
	 *    while it happened. Destroying them would destroy the defence, not the
	 *    exposure.
	 *  - **Analytics**, which are keyed to a device pseudonym and never to an
	 *    account. The link between the two is what gets deleted, which is what
	 *    makes the aggregates safe to keep.
	 */
	async deleteFor(
		input: DeletePisoCampSubjectDataInput & { actorId: string }
	): Promise<DeletePisoCampSubjectDataOutput> {
		const [account] = await db.select().from(users).where(eq(users.id, input.accountId))
		if (!account) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

		return databaseTransactionContext.transaction(async tx => {
			const profiles = await tx
				.delete(pisoCampProfiles)
				.where(eq(pisoCampProfiles.accountId, input.accountId))
				.returning()

			// The device link is the re-identification path: without it the
			// analytics pseudonym leads nowhere.
			const links = await tx
				.delete(pisoCampDeviceAccountLinks)
				.where(eq(pisoCampDeviceAccountLinks.accountId, input.accountId))
				.returning()

			const ended = await tx
				.delete(sessions)
				.where(eq(sessions.userId, input.accountId))
				.returning()

			const surveys = await tx
				.update(surveyResponses)
				.set({ accountId: null })
				.where(eq(surveyResponses.accountId, input.accountId))
				.returning()

			// Deleted, not unlinked: GM-3 keys a trivia response to an account and
			// SA-7 does not rewrite another ticket's schema to make room for a
			// response with nobody behind it. The pseudonymous analytics events for
			// the same activity are untouched.
			const answered = await tx
				.delete(triviaResponses)
				.where(eq(triviaResponses.accountId, input.accountId))
				.returning()

			const retained = await tx
				.select({ id: consentRecords.id })
				.from(consentRecords)
				.where(eq(consentRecords.accountId, input.accountId))

			// The row stays so the trail keeps its actor; what identified a person
			// does not.
			await tx
				.update(users)
				.set({
					name: "Deleted account",
					email: `deleted-${input.accountId}@invalid.local`,
					emailVerified: false,
					image: null,
					updatedAt: new Date(),
				})
				.where(eq(users.id, input.accountId))

			await tx
				.insert(pisoCampAccountState)
				.values({
					accountId: input.accountId,
					status: "deactivated",
					reason: `Data deleted under ${input.approvalReference}`,
					updatedBy: input.actorId,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: pisoCampAccountState.accountId,
					set: {
						status: "deactivated",
						reason: `Data deleted under ${input.approvalReference}`,
						updatedBy: input.actorId,
						updatedAt: new Date(),
					},
				})

			const result: DeletePisoCampSubjectDataOutput = {
				accountId: input.accountId,
				profileDeleted: profiles.length > 0,
				deviceLinksRemoved: links.length,
				sessionsEnded: ended.length,
				surveyResponsesPseudonymised: surveys.length,
				triviaResponsesDeleted: answered.length,
				consentRecordsRetained: retained.length,
			}

			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "data_subject.delete",
					actorId: input.actorId,
					targetType: "user",
					targetId: input.accountId,
					// What was there, and what was done about it. A deletion nobody
					// counted is one nobody can answer a question about later.
					oldValue: { email: account.email, name: account.name },
					newValue: result,
					reason: input.approvalReference,
				},
				tx
			)

			return result
		})
	}
}
