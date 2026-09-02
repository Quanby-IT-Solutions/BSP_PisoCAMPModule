import { Injectable } from "@nestjs/common"
import { eq, inArray } from "drizzle-orm"

import { moduleConfiguration } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Outputs } from "@/config/contract-types"

const SESSION_INACTIVITY_KEY = "session_inactivity_minutes" as const
const DEFAULT_SESSION_INACTIVITY_MINUTES = 30
const EXIT_ADVISORY_INTERVAL_KEY = "exit_advisory_interval_hours" as const
const DEFAULT_EXIT_ADVISORY_INTERVAL_HOURS = 24

@Injectable()
export class PisoCampAdminConfigService {
	constructor(private readonly auditService: AuditService) {}

	async get(): Promise<V1Outputs["pisocamp"]["admin"]["config"]["get"]> {
		const rows = await db
			.select({ key: moduleConfiguration.key, value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(
				inArray(moduleConfiguration.key, [SESSION_INACTIVITY_KEY, EXIT_ADVISORY_INTERVAL_KEY])
			)
		const stored = new Map(rows.map(row => [row.key, row.value]))

		return this.toConfig(
			stored.get(SESSION_INACTIVITY_KEY),
			stored.get(EXIT_ADVISORY_INTERVAL_KEY)
		)
	}

	/** EV-4's interval, for the public configuration a device reads. */
	async exitAdvisoryIntervalHours(): Promise<number> {
		const [row] = await db
			.select({ value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(eq(moduleConfiguration.key, EXIT_ADVISORY_INTERVAL_KEY))
		return this.toInterval(row?.value)
	}

	async update(input: {
		actorId: string
		session_inactivity_minutes: number
		exit_advisory_interval_hours: number
	}): Promise<V1Outputs["pisocamp"]["admin"]["config"]["update"]> {
		return databaseTransactionContext.transaction(async tx => {
			const current = await tx
				.select({ key: moduleConfiguration.key, value: moduleConfiguration.value })
				.from(moduleConfiguration)
				.where(
					inArray(moduleConfiguration.key, [
						SESSION_INACTIVITY_KEY,
						EXIT_ADVISORY_INTERVAL_KEY,
					])
				)
				.for("update")
			const stored = new Map(current.map(row => [row.key, row.value]))
			const before = this.toConfig(
				stored.get(SESSION_INACTIVITY_KEY),
				stored.get(EXIT_ADVISORY_INTERVAL_KEY)
			)
			const after = {
				session_inactivity_minutes: input.session_inactivity_minutes,
				exit_advisory_interval_hours: input.exit_advisory_interval_hours,
			}
			const now = new Date()

			// One audit entry per key, because each is a separate setting a person
			// can be asked about later, and a combined entry would hide which of
			// them actually moved.
			for (const [key, value, previous] of [
				[SESSION_INACTIVITY_KEY, after.session_inactivity_minutes, before.session_inactivity_minutes],
				[
					EXIT_ADVISORY_INTERVAL_KEY,
					after.exit_advisory_interval_hours,
					before.exit_advisory_interval_hours,
				],
			] as const) {
				await tx
					.insert(moduleConfiguration)
					.values({ key, value, updatedBy: input.actorId, updatedAt: now })
					.onConflictDoUpdate({
						target: moduleConfiguration.key,
						set: { value, updatedBy: input.actorId, updatedAt: now },
					})

				await this.auditService.record(
					{
						domain: "pisocamp",
						action: "module_configuration.update",
						actorId: input.actorId,
						targetType: "module_configuration",
						targetId: key,
						oldValue: previous,
						newValue: value,
					},
					tx
				)
			}

			return after
		})
	}

	private toConfig(
		sessionValue: unknown,
		intervalValue: unknown
	): V1Outputs["pisocamp"]["admin"]["config"]["get"] {
		return {
			session_inactivity_minutes:
				typeof sessionValue === "number" &&
				Number.isInteger(sessionValue) &&
				sessionValue >= 1 &&
				sessionValue <= 1440
					? sessionValue
					: DEFAULT_SESSION_INACTIVITY_MINUTES,
			exit_advisory_interval_hours: this.toInterval(intervalValue),
		}
	}

	/** A stored value outside the contract's range is not one to serve. */
	private toInterval(value: unknown): number {
		return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8760
			? value
			: DEFAULT_EXIT_ADVISORY_INTERVAL_HOURS
	}
}
