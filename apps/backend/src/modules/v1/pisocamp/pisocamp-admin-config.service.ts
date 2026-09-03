import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq, inArray } from "drizzle-orm"
import type { ZodType } from "zod"

import { PisoCampAdminConfigSchema } from "@repo/contracts/pisocamp-config"
import { moduleConfiguration, privacyNotices } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Outputs } from "@/config/contract-types"

type AdminConfig = V1Outputs["pisocamp"]["admin"]["config"]["get"]
type ConfigKey = keyof AdminConfig

/**
 * Every administrator-managed setting, and how to read one back.
 *
 * The key registry SA-3 asks for. Each entry is a key and the contract schema
 * that governs it, so reading, defaulting, writing and auditing are written
 * once over the list rather than once per setting — and a stored value that the
 * contract would refuse can never be served, whatever put it there.
 *
 * A new setting is a field on `PisoCampAdminConfigSchema` and a line here.
 */
const SETTINGS = Object.keys(PisoCampAdminConfigSchema.shape) as ConfigKey[]

/** The per-key schema, which carries both the validation and the default. */
function schemaFor(key: ConfigKey): ZodType {
	return PisoCampAdminConfigSchema.shape[key] as unknown as ZodType
}

@Injectable()
export class PisoCampAdminConfigService {
	constructor(private readonly auditService: AuditService) {}

	async get(): Promise<AdminConfig> {
		const rows = await db
			.select({ key: moduleConfiguration.key, value: moduleConfiguration.value })
			.from(moduleConfiguration)
			.where(inArray(moduleConfiguration.key, [...SETTINGS]))

		return this.toConfig(new Map(rows.map(row => [row.key, row.value])))
	}

	/** EV-4's interval, for the public configuration a device reads. */
	async exitAdvisoryIntervalHours(): Promise<number> {
		return (await this.get()).exit_advisory_interval_hours
	}

	/** AN-4's quiet period, for the retention report. */
	async churnInactivityDays(): Promise<number> {
		return (await this.get()).churn_inactivity_days
	}

	async update(
		input: AdminConfig & { actorId: string }
	): Promise<V1Outputs["pisocamp"]["admin"]["config"]["update"]> {
		// UM-005: the notice version names a stored notice. F4's consent flow
		// reads this same key and refuses to serve consent when it names one
		// that is not there, so a typo here would take consent down for
		// everybody rather than fail in front of the person who made it.
		//
		// Only when it changes. A value that was already stored is not something
		// this administrator is asserting, and refusing it would leave them
		// unable to save the session timeout because of somebody else's typo.
		const stored = await this.get()
		const versionChanged =
			input.active_privacy_notice_version !== stored.active_privacy_notice_version

		if (versionChanged && input.active_privacy_notice_version !== null) {
			const [notice] = await db
				.select({ version: privacyNotices.version })
				.from(privacyNotices)
				.where(eq(privacyNotices.version, input.active_privacy_notice_version))
			if (!notice) {
				throw new ORPCError("BAD_REQUEST", {
					message: `No privacy notice with version "${input.active_privacy_notice_version}" is stored`,
				})
			}
		}

		return databaseTransactionContext.transaction(async tx => {
			const current = await tx
				.select({ key: moduleConfiguration.key, value: moduleConfiguration.value })
				.from(moduleConfiguration)
				.where(inArray(moduleConfiguration.key, [...SETTINGS]))
				.for("update")
			const before = this.toConfig(new Map(current.map(row => [row.key, row.value])))
			const after = this.toConfig(new Map(SETTINGS.map(key => [key, input[key]])))
			const now = new Date()

			// One audit entry per key, because each is a separate setting a person
			// can be asked about later, and a combined entry would hide which of
			// them actually moved. Only the ones that moved: an audit trail full
			// of unchanged values is one nobody reads.
			for (const key of SETTINGS) {
				const value = after[key]
				const previous = before[key]

				if (value === null) {
					// A setting with no value is the absence of the setting, which is
					// what a missing row already means — and what `toConfig` reads
					// back as the default.
					await tx.delete(moduleConfiguration).where(eq(moduleConfiguration.key, key))
				} else {
					await tx
						.insert(moduleConfiguration)
						.values({ key, value, updatedBy: input.actorId, updatedAt: now })
						.onConflictDoUpdate({
							target: moduleConfiguration.key,
							set: { value, updatedBy: input.actorId, updatedAt: now },
						})
				}

				if (JSON.stringify(previous) === JSON.stringify(value)) continue

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

	private toConfig(stored: Map<string, unknown>): AdminConfig {
		return Object.fromEntries(
			SETTINGS.map(key => [key, this.toValue(key, stored.get(key))])
		) as AdminConfig
	}

	/** A stored value outside the contract's range is not one to serve. */
	private toValue(key: ConfigKey, value: unknown): AdminConfig[ConfigKey] {
		const parsed = schemaFor(key).safeParse(value)
		if (parsed.success) return parsed.data as AdminConfig[ConfigKey]

		// The schema carries the default, so parsing nothing yields it.
		return schemaFor(key).parse(undefined) as AdminConfig[ConfigKey]
	}
}
