import { Injectable } from "@nestjs/common"
import { eq, inArray } from "drizzle-orm"

import { moduleConfiguration } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Outputs } from "@/config/contract-types"

type AdminConfig = V1Outputs["pisocamp"]["admin"]["config"]["get"]

/**
 * The administrator-managed settings, declared once.
 *
 * Every one of them is the same thing — a whole number in a range, stored as a
 * row, audited when it moves — so reading, writing and auditing are written
 * once over this list rather than once per setting. A fourth setting is a line
 * here, not another copy of the same three blocks.
 */
const SETTINGS = [
	{ key: "session_inactivity_minutes", fallback: 30, min: 1, max: 1440 },
	{ key: "exit_advisory_interval_hours", fallback: 24, min: 1, max: 8760 },
	{ key: "churn_inactivity_days", fallback: 30, min: 1, max: 365 },
] as const satisfies readonly {
	key: keyof AdminConfig
	fallback: number
	min: number
	max: number
}[]

const KEYS = SETTINGS.map(setting => setting.key)

@Injectable()
export class PisoCampAdminConfigService {
	constructor(private readonly auditService: AuditService) {}

	async get(): Promise<AdminConfig> {
		const rows = await db
			.select({ key: moduleConfiguration.key, value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(inArray(moduleConfiguration.key, [...KEYS]))

		return this.toConfig(new Map(rows.map(row => [row.key, row.value])))
	}

	/** EV-4's interval, for the public configuration a device reads. */
	async exitAdvisoryIntervalHours(): Promise<number> {
		return this.readOne("exit_advisory_interval_hours")
	}

	/** AN-4's quiet period, for the retention report. */
	async churnInactivityDays(): Promise<number> {
		return this.readOne("churn_inactivity_days")
	}

	async update(
		input: AdminConfig & { actorId: string }
	): Promise<V1Outputs["pisocamp"]["admin"]["config"]["update"]> {
		return databaseTransactionContext.transaction(async tx => {
			const current = await tx
				.select({ key: moduleConfiguration.key, value: moduleConfiguration.value })
				.from(moduleConfiguration)
				.where(inArray(moduleConfiguration.key, [...KEYS]))
				.for("update")
			const before = this.toConfig(new Map(current.map(row => [row.key, row.value])))
			const after = this.toConfig(new Map(SETTINGS.map(s => [s.key, input[s.key]])))
			const now = new Date()

			// One audit entry per key, because each is a separate setting a person
			// can be asked about later, and a combined entry would hide which of
			// them actually moved.
			for (const { key } of SETTINGS) {
				const value = after[key]

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
						oldValue: before[key],
						newValue: value,
					},
					tx
				)
			}

			return after
		})
	}

	private async readOne(key: (typeof SETTINGS)[number]["key"]): Promise<number> {
		const [row] = await db
			.select({ value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(eq(moduleConfiguration.key, key))
		return this.toNumber(key, row?.value)
	}

	private toConfig(stored: Map<string, unknown>): AdminConfig {
		return Object.fromEntries(
			SETTINGS.map(setting => [setting.key, this.toNumber(setting.key, stored.get(setting.key))])
		) as AdminConfig
	}

	/** A stored value outside the contract's range is not one to serve. */
	private toNumber(key: (typeof SETTINGS)[number]["key"], value: unknown): number {
		const setting = SETTINGS.find(candidate => candidate.key === key)!
		return typeof value === "number" &&
			Number.isInteger(value) &&
			value >= setting.min &&
			value <= setting.max
			? value
			: setting.fallback
	}
}
