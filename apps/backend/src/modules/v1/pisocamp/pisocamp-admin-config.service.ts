import { Injectable } from "@nestjs/common"
import { eq } from "drizzle-orm"

import { moduleConfiguration } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Outputs } from "@/config/contract-types"

const SESSION_INACTIVITY_KEY = "session_inactivity_minutes" as const
const DEFAULT_SESSION_INACTIVITY_MINUTES = 30

@Injectable()
export class PisoCampAdminConfigService {
	constructor(private readonly auditService: AuditService) {}

	async get(): Promise<V1Outputs["pisocamp"]["admin"]["config"]["get"]> {
		const [row] = await db
			.select({ value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(eq(moduleConfiguration.key, SESSION_INACTIVITY_KEY))

		return this.toConfig(row?.value)
	}

	async update(input: {
		actorId: string
		session_inactivity_minutes: number
	}): Promise<V1Outputs["pisocamp"]["admin"]["config"]["update"]> {
		return databaseTransactionContext.transaction(async tx => {
			const [current] = await tx
				.select({ value: moduleConfiguration.value })
				.from(moduleConfiguration)
				.where(eq(moduleConfiguration.key, SESSION_INACTIVITY_KEY))
				.for("update")
			const before = this.toConfig(current?.value).session_inactivity_minutes
			const after = input.session_inactivity_minutes

			await tx
				.insert(moduleConfiguration)
				.values({
					key: SESSION_INACTIVITY_KEY,
					value: after,
					updatedBy: input.actorId,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: moduleConfiguration.key,
					set: { value: after, updatedBy: input.actorId, updatedAt: new Date() },
				})

			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "module_configuration.update",
					actorId: input.actorId,
					targetType: "module_configuration",
					targetId: SESSION_INACTIVITY_KEY,
					oldValue: before,
					newValue: after,
				},
				tx
			)

			return { session_inactivity_minutes: after }
		})
	}

	private toConfig(value: unknown): V1Outputs["pisocamp"]["admin"]["config"]["get"] {
		return {
			session_inactivity_minutes:
				typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1440
					? value
					: DEFAULT_SESSION_INACTIVITY_MINUTES,
		}
	}
}
