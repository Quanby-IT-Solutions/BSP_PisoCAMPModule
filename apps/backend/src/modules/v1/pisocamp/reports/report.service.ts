import { Injectable } from "@nestjs/common"
import { desc, eq } from "drizzle-orm"
import { ORPCError } from "@orpc/server"

import {
	DEMOGRAPHIC_FILTER_KEYS,
	REPORT_DEFINITIONS,
	type ReportDefinitionKey,
	type ReportFilters,
	type ReportResult,
	type ReportRun,
} from "@repo/contracts/pisocamp-report"
import { reportDefinitions, reportRuns } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

import { AdoptionService } from "../analytics/adoption.service"
import { EngagementService } from "../analytics/engagement.service"
import { RetentionService } from "../analytics/retention.service"
import { ActivityService } from "./activity.service"
import { namedFilters } from "./report-filters"

const MANILA = "Asia/Manila"

const SUPPRESSION_REASON =
	"Demographic filters are withheld until AN-10 adds consent scoping and small-group suppression."

type Range = { from: string; to: string; filters: ReportFilters }

@Injectable()
export class ReportService {
	constructor(
		private readonly engagement: EngagementService,
		private readonly retention: RetentionService,
		private readonly adoption: AdoptionService,
		private readonly activity: ActivityService,
		private readonly auditService: AuditService
	) {}

	/**
	 * How each definition is computed.
	 *
	 * The only place in the framework that names a report. Running, recording,
	 * auditing and listing know nothing but the key, so a new KPI is a registry
	 * entry and a line here.
	 */
	private get runners(): Record<ReportDefinitionKey, (range: Range) => Promise<ReportResult>> {
		return {
			engagement: async range => ({
				definitionKey: "engagement",
				engagement: await this.engagement.summary({ from: range.from, to: range.to }),
			}),
			retention: async range => ({
				definitionKey: "retention",
				retention: await this.retention.summary({ from: range.from, to: range.to }),
			}),
			adoption: async range => ({
				definitionKey: "adoption",
				adoption: await this.adoption.summary(range),
			}),
			activity: async range => ({
				definitionKey: "activity",
				activity: await this.activity.summary(range),
			}),
			audit: async range => ({
				definitionKey: "audit",
				audit: await this.auditReport(range),
			}),
		}
	}

	/**
	 * SA-4's trail, as a report AN-9 can export.
	 *
	 * The rows come from `AuditService.list`, the audit domain's own query, so
	 * the file says exactly what the viewer says. Bounded: a report is a
	 * document somebody opens, and it says so when there was more.
	 */
	private async auditReport(range: Range) {
		const limit = 5000
		const { entries, nextCursor } = await this.auditService.list({
			limit,
			from: range.from,
			to: range.to,
			...(range.filters.actor ? { actorId: range.filters.actor } : {}),
			...(range.filters.activityType ? { action: range.filters.activityType } : {}),
			...(range.filters.targetType ? { targetType: range.filters.targetType } : {}),
		})

		return {
			from: range.from,
			to: range.to,
			timezone: "Asia/Manila" as const,
			entryCount: entries.length,
			truncated: nextCursor !== null,
			entries: entries.map(entry => ({
				id: entry.id,
				at: entry.createdAt.toISOString(),
				// The address when the account still exists, the id when it does
				// not: an entry outlives the account that produced it, by design.
				actor: entry.actorEmail ?? entry.actorId ?? "system",
				action: entry.action,
				outcome: entry.outcome,
				target: [entry.targetType, entry.targetId].filter(Boolean).join(" ") || "—",
				before: entry.oldValue === null ? "" : JSON.stringify(entry.oldValue),
				after: entry.newValue === null ? "" : JSON.stringify(entry.newValue),
				reason: entry.reason ?? "",
			})),
		}
	}

	/**
	 * Make sure the database has a row for the definition being run.
	 *
	 * The registry in `@repo/contracts` is the source of truth; this row exists
	 * only so a run can point at a definition that is really there. It is written
	 * when a report is run rather than at start-up, because the whole API failing
	 * to boot over a copy of a list that already lives in the code would be a
	 * much worse outage than the one it was guarding against.
	 */
	private async ensureDefinition(
		tx: Pick<typeof db, "insert">,
		definition: (typeof REPORT_DEFINITIONS)[number]
	): Promise<void> {
		await tx
			.insert(reportDefinitions)
			.values({
				key: definition.key,
				name: definition.name,
				description: definition.description,
				dataSource: definition.dataSource,
				supportedFilters: [...definition.filters],
			})
			.onConflictDoUpdate({
				target: reportDefinitions.key,
				set: {
					name: definition.name,
					description: definition.description,
					dataSource: definition.dataSource,
					supportedFilters: [...definition.filters],
					updatedAt: new Date(),
				},
			})
	}

	listDefinitions() {
		return {
			definitions: REPORT_DEFINITIONS.map(definition => ({
				key: definition.key,
				name: definition.name,
				description: definition.description,
				dataSource: definition.dataSource,
				filters: [...definition.filters],
			})),
		}
	}

	async listRuns(input: { limit: number }): Promise<{ runs: ReportRun[] }> {
		const rows = await db
			.select()
			.from(reportRuns)
			.orderBy(desc(reportRuns.generatedAt), desc(reportRuns.id))
			.limit(input.limit)

		return { runs: rows.map(row => this.toReportRun(row)) }
	}

	/**
	 * Run one report, record it, and audit the generation.
	 *
	 * The result is stored rather than recomputed on read: a historical report
	 * has to say the same thing next month as it says today, and AN-9 exports
	 * this row rather than running the query a second time.
	 */
	async generate(input: {
		id: string
		definitionKey: ReportDefinitionKey
		from: string
		to: string
		filters: ReportFilters
		actorId: string
	}): Promise<ReportRun> {
		const definition = REPORT_DEFINITIONS.find(entry => entry.key === input.definitionKey)
		if (!definition) {
			throw new ORPCError("NOT_FOUND", { message: "No such report definition" })
		}

		// A replay of a lost response returns the first run. Generating the same
		// report twice under one id would put two answers behind one identifier.
		const [existing] = await db.select().from(reportRuns).where(eq(reportRuns.id, input.id))
		if (existing) return this.toReportRun(existing)

		const asked = namedFilters(input.filters)
		const demographic = asked.filter(key =>
			(DEMOGRAPHIC_FILTER_KEYS as readonly string[]).includes(key)
		)
		// Demographic filters are handled by suppressing the report, so they are
		// not "unsupported"; anything else the definition does not declare is.
		const unsupported = asked.filter(
			key =>
				!(definition.filters as readonly string[]).includes(key) &&
				!demographic.includes(key)
		)

		// A filter this report cannot apply is refused by name rather than
		// ignored: a report that quietly dropped a filter would answer a
		// different question from the one that was asked.
		if (unsupported.length > 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: `${definition.name} cannot filter by ${unsupported.join(", ")}`,
			})
		}

		const suppressed = demographic.length > 0
		const result = suppressed ? null : await this.runners[definition.key](input)

		return databaseTransactionContext.transaction(async tx => {
			await this.ensureDefinition(tx, definition)

			const [row] = await tx
				.insert(reportRuns)
				.values({
					id: input.id,
					definitionKey: definition.key,
					requestedBy: input.actorId,
					fromDate: input.from,
					toDate: input.to,
					filters: input.filters,
					suppressed,
					suppressionReason: suppressed ? SUPPRESSION_REASON : null,
					result,
				})
				.returning()

			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "report.generate",
					actorId: input.actorId,
					targetType: "report_run",
					targetId: input.id,
					newValue: {
						definitionKey: definition.key,
						from: input.from,
						to: input.to,
						filters: input.filters,
						suppressed,
					},
				},
				tx
			)

			return this.toReportRun(row!)
		})
	}

	/**
	 * One stored row as the run the contract describes.
	 *
	 * Public because AN-9 exports the stored run rather than re-running the
	 * query: an export has to be the report it claims to be.
	 */
	toReportRun(row: typeof reportRuns.$inferSelect): ReportRun {
		const definition = REPORT_DEFINITIONS.find(entry => entry.key === row.definitionKey)

		return {
			id: row.id,
			definitionKey: row.definitionKey as ReportDefinitionKey,
			definitionName: definition?.name ?? row.definitionKey,
			dataSource: definition?.dataSource ?? "unknown",
			generatedAt: row.generatedAt.toISOString(),
			generatedBy: row.requestedBy ?? "deleted account",
			from: row.fromDate,
			to: row.toDate,
			timezone: MANILA,
			filters: row.filters as ReportFilters,
			suppressed: row.suppressed,
			suppressionReason: row.suppressionReason,
			result: (row.result as ReportResult | null) ?? null,
		}
	}
}
