import { Injectable } from "@nestjs/common"
import { and, eq, sql } from "drizzle-orm"

import type {
	AcquisitionSummary,
	ImportStoreMetricsInput,
	StoreMetric,
} from "@repo/contracts/pisocamp-acquisition"
import { storeMetricImports } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

const MANILA = "Asia/Manila"

const SOURCE_LABELS: Record<string, string> = {
	google_play: "Google Play",
	app_store: "App Store",
}

@Injectable()
export class AcquisitionService {
	constructor(private readonly audit: AuditService) {}

	/**
	 * Install volume and ratings for a range of Asia/Manila days.
	 *
	 * The two install figures count different things — a store counts downloads
	 * and `first_open` counts devices that actually opened the module — so they
	 * are reported side by side and never added together.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["acquisition"]
	): Promise<AcquisitionSummary> {
		const range = sql`
			e.occurred_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and e.occurred_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`
		// A period counts when the whole of it falls inside the range: half a
		// month's installs reported against a month is not a figure.
		const covered = sql`
			period_start >= ${input.from}::date and period_end <= ${input.to}::date
		`

		const [firstOpens] = (
			await db.execute<{ devices: string }>(sql`
				select count(distinct e.subject_pseudo_id)::text as "devices"
				from analytics_event e
				where ${range} and e.event_name = 'first_open'
			`)
		).rows

		const stores = (
			await db.execute<{
				source: "google_play" | "app_store"
				installs: string
				uninstalls: string
				ratingSum: string | null
				ratingCount: string | null
				periods: string
			}>(sql`
				select
					source as "source",
					sum(installs)::text as "installs",
					sum(uninstalls)::text as "uninstalls",
					-- Weighted by how many ratings each period carried: an average
					-- of averages would let a quiet week outweigh a busy one.
					sum(rating_average * rating_count)::text as "ratingSum",
					sum(rating_count)::text as "ratingCount",
					count(*)::text as "periods"
				from store_metric_import
				where ${covered}
				group by source
				order by source
			`)
		).rows

		const [inApp] = (
			await db.execute<{ total: string | null; answers: string }>(sql`
				select
					sum(a.scale_value)::text as "total",
					count(*)::text as "answers"
				from survey_answer a
				join survey_response r on r.response_id = a.response_id
				join survey_question q on q.id = a.question_id
				where q.kind = 'rating'
					and a.skipped is false
					and a.scale_value is not null
					and r.submitted_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
					and r.submitted_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
			`)
		).rows

		const storeMetrics: StoreMetric[] = stores.map(row => {
			const ratingCount = row.ratingCount === null ? null : Number(row.ratingCount)
			const ratingSum = row.ratingSum === null ? null : Number(row.ratingSum)
			return {
				source: row.source,
				installs: Number(row.installs),
				uninstalls: Number(row.uninstalls),
				ratingAverage:
					ratingSum === null || ratingCount === null || ratingCount === 0
						? null
						: this.round(ratingSum / ratingCount),
				ratingCount,
				periods: Number(row.periods),
			}
		})

		const storeInstalls = storeMetrics.reduce((sum, store) => sum + store.installs, 0)
		const storeUninstalls = storeMetrics.reduce((sum, store) => sum + store.uninstalls, 0)
		const firstOpenDevices = Number(firstOpens?.devices ?? 0)
		const storeRatings = storeMetrics.reduce((sum, store) => sum + (store.ratingCount ?? 0), 0)
		const storeRatingTotal = storeMetrics.reduce(
			(sum, store) => sum + (store.ratingAverage ?? 0) * (store.ratingCount ?? 0),
			0
		)
		const inAppAnswers = Number(inApp?.answers ?? 0)
		const inAppTotal = Number(inApp?.total ?? 0)

		const combinedRatings = storeRatings + inAppAnswers
		const headlineSource =
			storeMetrics.length > 0 ? "store" : firstOpenDevices > 0 ? "in_app" : null

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			installVolume: {
				firstOpenDevices,
				storeInstalls,
				storeUninstalls,
				headlineSource,
				headlineInstalls:
					headlineSource === "store"
						? storeInstalls
						: headlineSource === "in_app"
							? firstOpenDevices
							: null,
				// The label is part of the figure: "installs" from two sources are
				// two different counts, and a reader has to be told which one.
				sourceLabel:
					headlineSource === "store"
						? `Store reports (${storeMetrics
								.map(store => SOURCE_LABELS[store.source] ?? store.source)
								.join(", ")})`
						: headlineSource === "in_app"
							? "First opens reported by the module"
							: "No install data for this range",
			},
			stores: storeMetrics,
			ratings: {
				inAppAverage: inAppAnswers === 0 ? null : this.round(inAppTotal / inAppAnswers),
				inAppResponses: inAppAnswers,
				storeAverage: storeRatings === 0 ? null : this.round(storeRatingTotal / storeRatings),
				storeRatings,
				// Weighted by how many ratings each side has: an average of two
				// averages would let ten store ratings outweigh a thousand
				// in-app ones.
				combinedAverage:
					combinedRatings === 0
						? null
						: this.round((storeRatingTotal + inAppTotal) / combinedRatings),
				combinedRatings,
			},
			storeDataAvailable: storeMetrics.length > 0,
		}
	}

	/**
	 * The §12 store import.
	 *
	 * Re-importing a store's period replaces it rather than adding to it, so a
	 * retried upload cannot double an install count.
	 */
	async importStoreMetrics(input: ImportStoreMetricsInput, actorId: string) {
		return db.transaction(async tx => {
			let replaced = 0
			for (const row of input.rows) {
				const existing = await tx
					.select({ id: storeMetricImports.id })
					.from(storeMetricImports)
					.where(
						and(
							eq(storeMetricImports.source, row.source),
							eq(storeMetricImports.periodStart, row.periodStart),
							eq(storeMetricImports.periodEnd, row.periodEnd)
						)
					)
				if (existing.length > 0) {
					replaced += 1
					await tx
						.delete(storeMetricImports)
						.where(
							and(
								eq(storeMetricImports.source, row.source),
								eq(storeMetricImports.periodStart, row.periodStart),
								eq(storeMetricImports.periodEnd, row.periodEnd)
							)
						)
				}
				await tx.insert(storeMetricImports).values({
					source: row.source,
					periodStart: row.periodStart,
					periodEnd: row.periodEnd,
					installs: row.installs,
					uninstalls: row.uninstalls,
					ratingAverage: row.ratingAverage,
					ratingCount: row.ratingCount,
					importedBy: actorId,
				})
			}

			await this.audit.record(
				{
					domain: "pisocamp",
					action: "store_metrics.import",
					actorId,
					targetType: "store_metric_import",
					targetId: input.rows.map(row => `${row.source}:${row.periodStart}`).join(","),
					newValue: { imported: input.rows.length, replaced },
				},
				tx
			)

			return { imported: input.rows.length, replaced }
		})
	}

	private round(value: number): number {
		return Math.round(value * 100) / 100
	}
}
