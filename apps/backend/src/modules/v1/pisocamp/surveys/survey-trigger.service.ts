import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq } from "drizzle-orm"

import { contentItems, contentVersions, surveyTriggerRules } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

type UpsertInput = V1Inputs["pisocamp"]["admin"]["surveyTriggers"]["upsert"] & {
	actorId: string
}
type DeleteInput = V1Inputs["pisocamp"]["admin"]["surveyTriggers"]["remove"] & {
	actorId: string
}

@Injectable()
export class SurveyTriggerService {
	constructor(private readonly auditService: AuditService) {}

	async list(): Promise<V1Outputs["pisocamp"]["admin"]["surveyTriggers"]["list"]> {
		const rows = await db
			.select({
				id: surveyTriggerRules.id,
				contentItemId: surveyTriggerRules.contentItemId,
				surveyTitle: contentVersions.title,
				triggerType: surveyTriggerRules.triggerType,
				pageDepth: surveyTriggerRules.pageDepth,
				frequencyCapDays: surveyTriggerRules.frequencyCapDays,
				priority: surveyTriggerRules.priority,
				enabled: surveyTriggerRules.enabled,
				updatedAt: surveyTriggerRules.updatedAt,
			})
			.from(surveyTriggerRules)
			.innerJoin(contentItems, eq(contentItems.id, surveyTriggerRules.contentItemId))
			.innerJoin(
				contentVersions,
				eq(contentVersions.id, contentItems.currentWorkingVersionId)
			)
			.orderBy(asc(surveyTriggerRules.priority), asc(surveyTriggerRules.contentItemId))

		return {
			rules: rows.map(row => ({
				...row,
				updatedAt: row.updatedAt.toISOString(),
			})),
		}
	}

	/**
	 * Creates or replaces one rule.
	 *
	 * A rule may only name a **published** survey: a trigger for a draft would
	 * be a rule that fires on nothing, because a draft is not in the bundle the
	 * device reads.
	 */
	async upsert(
		input: UpsertInput
	): Promise<V1Outputs["pisocamp"]["admin"]["surveyTriggers"]["upsert"]> {
		return databaseTransactionContext.transaction(async tx => {
			const [item] = await tx
				.select({
					contentType: contentItems.contentType,
					status: contentItems.status,
					title: contentVersions.title,
				})
				.from(contentItems)
				.innerJoin(
					contentVersions,
					eq(contentVersions.id, contentItems.currentWorkingVersionId)
				)
				.where(eq(contentItems.id, input.contentItemId))
			if (!item || item.contentType !== "survey") {
				throw new ORPCError("NOT_FOUND", { message: "Survey not found" })
			}
			if (item.status !== "published") {
				throw new ORPCError("CONFLICT", {
					message: "Only a published survey can carry a trigger rule",
				})
			}

			const [existing] = await tx
				.select()
				.from(surveyTriggerRules)
				.where(
					and(
						eq(surveyTriggerRules.contentItemId, input.contentItemId),
						eq(surveyTriggerRules.triggerType, input.triggerType)
					)
				)
				.for("update")

			const values = {
				contentItemId: input.contentItemId,
				triggerType: input.triggerType,
				pageDepth: input.pageDepth ?? null,
				frequencyCapDays: input.frequencyCapDays ?? null,
				priority: input.priority,
				enabled: input.enabled,
				updatedBy: input.actorId,
				updatedAt: new Date(),
			}

			const [saved] = existing
				? await tx
						.update(surveyTriggerRules)
						.set(values)
						.where(eq(surveyTriggerRules.id, existing.id))
						.returning()
				: await tx
						.insert(surveyTriggerRules)
						.values({ ...values, createdBy: input.actorId })
						.returning()
			if (!saved) throw new ORPCError("INTERNAL_SERVER_ERROR")

			await this.auditService.record(
				{
					domain: "pisocamp",
					action: existing ? "survey_trigger.update" : "survey_trigger.create",
					actorId: input.actorId,
					targetType: "survey_trigger_rule",
					targetId: saved.id,
					oldValue: existing ? this.audited(existing) : undefined,
					newValue: this.audited(saved),
				},
				tx
			)

			return {
				id: saved.id,
				contentItemId: saved.contentItemId,
				surveyTitle: item.title,
				triggerType: saved.triggerType,
				pageDepth: saved.pageDepth,
				frequencyCapDays: saved.frequencyCapDays,
				priority: saved.priority,
				enabled: saved.enabled,
				updatedAt: saved.updatedAt.toISOString(),
			}
		})
	}

	async remove(
		input: DeleteInput
	): Promise<V1Outputs["pisocamp"]["admin"]["surveyTriggers"]["remove"]> {
		return databaseTransactionContext.transaction(async tx => {
			const [existing] = await tx
				.select()
				.from(surveyTriggerRules)
				.where(
					and(
						eq(surveyTriggerRules.contentItemId, input.contentItemId),
						eq(surveyTriggerRules.triggerType, input.triggerType)
					)
				)
				.for("update")
			if (!existing) return { deleted: false }

			await tx.delete(surveyTriggerRules).where(eq(surveyTriggerRules.id, existing.id))
			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "survey_trigger.delete",
					actorId: input.actorId,
					targetType: "survey_trigger_rule",
					targetId: existing.id,
					oldValue: this.audited(existing),
				},
				tx
			)
			return { deleted: true }
		})
	}

	/**
	 * The rules a device is given.
	 *
	 * Enabled rules on published surveys only: a disabled rule and a withdrawn
	 * survey are both things the device must stop asking about, and the way to
	 * stop it is to not send the rule.
	 */
	async publicRules(): Promise<
		V1Outputs["pisocamp"]["config"]["get"]["survey_triggers"]
	> {
		const rows = await db
			.select({
				contentItemId: surveyTriggerRules.contentItemId,
				triggerType: surveyTriggerRules.triggerType,
				pageDepth: surveyTriggerRules.pageDepth,
				frequencyCapDays: surveyTriggerRules.frequencyCapDays,
				priority: surveyTriggerRules.priority,
			})
			.from(surveyTriggerRules)
			.innerJoin(contentItems, eq(contentItems.id, surveyTriggerRules.contentItemId))
			.where(
				and(eq(surveyTriggerRules.enabled, true), eq(contentItems.status, "published"))
			)
			.orderBy(asc(surveyTriggerRules.priority), asc(surveyTriggerRules.contentItemId))
		return rows
	}

	private audited(rule: typeof surveyTriggerRules.$inferSelect) {
		return {
			contentItemId: rule.contentItemId,
			triggerType: rule.triggerType,
			pageDepth: rule.pageDepth,
			frequencyCapDays: rule.frequencyCapDays,
			priority: rule.priority,
			enabled: rule.enabled,
		}
	}
}
