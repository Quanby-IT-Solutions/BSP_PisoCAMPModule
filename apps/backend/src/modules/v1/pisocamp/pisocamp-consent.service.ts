import {
	ConflictException,
	Inject,
	Injectable,
	ServiceUnavailableException,
	type Provider,
} from "@nestjs/common"
import { and, desc, eq, inArray, or } from "drizzle-orm"

import type { DBClient } from "@repo/db/client"
import {
	consentRecords,
	moduleConfiguration,
	pisoCampDeviceAccountLinks,
	privacyNotices,
} from "@repo/db/schema"

import {
	databaseTransactionContext,
	type DatabaseTransaction,
} from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

export const PISOCAMP_CONSENT_DATABASE = Symbol("PISOCAMP_CONSENT_DATABASE")
export const PISOCAMP_CONSENT_TRANSACTIONS = Symbol("PISOCAMP_CONSENT_TRANSACTIONS")
const ACTIVE_NOTICE_VERSION_KEY = "active_privacy_notice_version" as const

export type ConsentSubject = { accountId: string } | { devicePseudoId: string }

export interface ConsentTransactionRunner {
	transaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T>
}

export const pisoCampConsentDatabaseProvider: Provider = {
	provide: PISOCAMP_CONSENT_DATABASE,
	useValue: db,
}

export const pisoCampConsentTransactionProvider: Provider = {
	provide: PISOCAMP_CONSENT_TRANSACTIONS,
	useValue: databaseTransactionContext,
}

@Injectable()
export class PisoCampConsentService {
	constructor(
		@Inject(PISOCAMP_CONSENT_DATABASE) private readonly database: DBClient,
		@Inject(PISOCAMP_CONSENT_TRANSACTIONS)
		private readonly transactions: ConsentTransactionRunner
	) {}

	async getStatus(
		subject: ConsentSubject,
		purpose: V1Inputs["pisocamp"]["consent"]["get"]["purpose"]
	): Promise<V1Outputs["pisocamp"]["consent"]["get"]> {
		const notice = await this.getActiveNotice(this.database)
		const subjectWhere = await this.subjectWhere(subject, purpose)
		const [current] = await this.database
			.select({ status: consentRecords.status })
			.from(consentRecords)
			.where(
				and(
					subjectWhere,
					eq(consentRecords.purpose, purpose),
					eq(consentRecords.noticeId, notice.id),
					eq(consentRecords.noticeVersion, notice.version)
				)
			)
			.orderBy(desc(consentRecords.recordedAt))
			.limit(1)

		let state: V1Outputs["pisocamp"]["consent"]["get"]["state"]
		if (current) {
			state = current.status
		} else {
			const [historical] = await this.database
				.select({ id: consentRecords.id })
				.from(consentRecords)
				.where(and(subjectWhere, eq(consentRecords.purpose, purpose)))
				.limit(1)
			state = historical ? "requires_reconsent" : "none"
		}

		return { purpose, state, notice: this.toNoticeOutput(notice) }
	}

	async record(
		subject: ConsentSubject,
		input: V1Inputs["pisocamp"]["consent"]["record"]
	): Promise<V1Outputs["pisocamp"]["consent"]["record"]> {
		return this.transactions.transaction(async tx => {
			const [existing] = await tx
				.select()
				.from(consentRecords)
				.where(eq(consentRecords.id, input.id))
				.limit(1)
			if (existing) {
				if (!this.matches(existing, subject, input)) {
					throw new ConflictException("Consent record id is already in use")
				}
				return this.toRecordOutput(existing)
			}

			const active = await this.getActiveNotice(tx)
			if (active.id !== input.noticeId || active.version !== input.noticeVersion) {
				throw new ConflictException("Privacy notice is no longer current")
			}

			const [inserted] = await tx
				.insert(consentRecords)
				.values({
					id: input.id,
					accountId: "accountId" in subject ? subject.accountId : null,
					devicePseudoId: "devicePseudoId" in subject ? subject.devicePseudoId : null,
					purpose: input.purpose,
					noticeId: input.noticeId,
					noticeVersion: input.noticeVersion,
					status: input.decision,
					respondedAt: new Date(input.respondedAt),
				})
				.returning()

			if (!inserted) throw new ServiceUnavailableException("Consent is temporarily unavailable")
			return this.toRecordOutput(inserted)
		})
	}

	private async subjectWhere(
		subject: ConsentSubject,
		purpose: V1Inputs["pisocamp"]["consent"]["get"]["purpose"]
	) {
		if ("devicePseudoId" in subject)
			return eq(consentRecords.devicePseudoId, subject.devicePseudoId)
		if (purpose !== "registration") return eq(consentRecords.accountId, subject.accountId)
		const links = await this.database
			.select({ consentRecordId: pisoCampDeviceAccountLinks.registrationConsentRecordId })
			.from(pisoCampDeviceAccountLinks)
			.where(eq(pisoCampDeviceAccountLinks.accountId, subject.accountId))
		return links.length === 0
			? eq(consentRecords.accountId, subject.accountId)
			: or(
					eq(consentRecords.accountId, subject.accountId),
					inArray(
						consentRecords.id,
						links.map(link => link.consentRecordId)
					)
				)!
	}

	private async getActiveNotice(database: Pick<DBClient, "select">) {
		const [configuration] = await database
			.select({ value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(eq(moduleConfiguration.key, ACTIVE_NOTICE_VERSION_KEY))
			.limit(1)
		if (typeof configuration?.value !== "string") {
			throw new ServiceUnavailableException("Consent is temporarily unavailable")
		}

		const [notice] = await database
			.select()
			.from(privacyNotices)
			.where(eq(privacyNotices.version, configuration.value))
			.limit(1)
		if (!notice) throw new ServiceUnavailableException("Consent is temporarily unavailable")
		return notice
	}

	private matches(
		existing: typeof consentRecords.$inferSelect,
		subject: ConsentSubject,
		input: V1Inputs["pisocamp"]["consent"]["record"]
	): boolean {
		return (
			existing.accountId === ("accountId" in subject ? subject.accountId : null) &&
			existing.devicePseudoId === ("devicePseudoId" in subject ? subject.devicePseudoId : null) &&
			existing.purpose === input.purpose &&
			existing.noticeId === input.noticeId &&
			existing.noticeVersion === input.noticeVersion &&
			existing.status === input.decision &&
			existing.respondedAt.getTime() === new Date(input.respondedAt).getTime()
		)
	}

	private toNoticeOutput(notice: typeof privacyNotices.$inferSelect) {
		return {
			id: notice.id,
			version: notice.version,
			title: notice.title,
			body: notice.body,
			sourceUrl: notice.sourceUrl,
			contentSha256: notice.contentSha256,
			effectiveAt: notice.effectiveAt.toISOString(),
		}
	}

	private toRecordOutput(
		record: typeof consentRecords.$inferSelect
	): V1Outputs["pisocamp"]["consent"]["record"] {
		return {
			id: record.id,
			purpose: record.purpose,
			noticeId: record.noticeId,
			noticeVersion: record.noticeVersion,
			// Withdrawal is now an answer in its own right, so it is reported as
			// itself rather than flattened into a decline it never was.
			decision: record.status,
			respondedAt: record.respondedAt.toISOString(),
			recordedAt: record.recordedAt.toISOString(),
			state: record.status,
		}
	}
}
