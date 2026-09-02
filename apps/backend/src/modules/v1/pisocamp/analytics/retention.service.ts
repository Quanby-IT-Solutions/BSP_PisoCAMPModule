import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"

const MANILA = "Asia/Manila"

/** The days AN-015 asks about. */
const RETENTION_DAYS = [1, 7, 30] as const

type Summary = V1Outputs["pisocamp"]["analytics"]["retention"]
type Cohort = Summary["cohorts"][number]

@Injectable()
export class RetentionService {
	constructor(private readonly adminConfig: PisoCampAdminConfigService) {}

	/**
	 * Retention cohorts, churn, lifetime, re-engagement and reactivation.
	 *
	 * "Qualifying activity" is a session on an Asia/Manila day, which is what
	 * AN-2 already materialises. Coming back is a thing people do on days, not
	 * at instants, so days are the unit throughout.
	 */
	async summary(input: V1Inputs["pisocamp"]["analytics"]["retention"]): Promise<Summary> {
		const churnInactivityDays = await this.adminConfig.churnInactivityDays()

		/**
		 * Everybody's first and last active day, as at the end of the range.
		 *
		 * Bounded by `to` so the same range answers the same way tomorrow: a
		 * report whose figures drift as later data lands is not a report.
		 */
		const lifespans = sql`
			select subject_pseudo_id, min(local_date) as cohort_date, max(local_date) as last_seen
			from analytics_session
			where local_date <= ${input.to}::date
			group by subject_pseudo_id
		`

		const cohortRows = (
			await db.execute<{
				cohortDate: string
				users: string
				d1: string
				d7: string
				d30: string
			}>(sql`
				with lifespans as (${lifespans}), cohorts as (
					select cohort_date, subject_pseudo_id
					from lifespans
					where cohort_date between ${input.from}::date and ${input.to}::date
				), returns as (
					select
						c.cohort_date,
						c.subject_pseudo_id,
						${sql.join(
							RETENTION_DAYS.map(
								day => sql`max(
									case when s.local_date = c.cohort_date + ${day}::int then 1 else 0 end
								) as ${sql.raw(`d${day}`)}`
							),
							sql`, `
						)}
					from cohorts c
					left join analytics_session s on s.subject_pseudo_id = c.subject_pseudo_id
					group by c.cohort_date, c.subject_pseudo_id
				)
				select
					cohort_date::text as "cohortDate",
					count(*)::text as "users",
					${sql.join(
						RETENTION_DAYS.map(
							day => sql`sum(${sql.raw(`d${day}`)})::text as ${sql.raw(`"d${day}"`)}`
						),
						sql`, `
					)}
				from returns
				group by cohort_date
				order by cohort_date
			`)
		).rows

		const [churn] = (
			await db.execute<{
				known: string
				churned: string
				averageLifetimeDays: string | null
				medianLifetimeDays: string | null
			}>(sql`
				with lifespans as (${lifespans})
				select
					count(*)::text as "known",
					-- Quiet for longer than the period, measured at the report end
					-- rather than today, so a historical range stays reproducible.
					count(*) filter (
						where last_seen < ${input.to}::date - ${churnInactivityDays}::int
					)::text as "churned",
					avg(last_seen - cohort_date)::text as "averageLifetimeDays",
					percentile_cont(0.5) within group (order by (last_seen - cohort_date))::text
						as "medianLifetimeDays"
				from lifespans
			`)
		).rows

		const [returns] = (
			await db.execute<{
				lapsed: string
				reengaged: string
				dormant: string
				reactivated: string
			}>(sql`
				with last_before as (
					select subject_pseudo_id, max(local_date) as last_seen
					from analytics_session
					where local_date < ${input.from}::date
					group by subject_pseudo_id
				), pools as (
					select
						(${input.from}::date - b.last_seen) as days_quiet,
						exists (
							select 1 from analytics_session s
							where s.subject_pseudo_id = b.subject_pseudo_id
								and s.local_date between ${input.from}::date and ${input.to}::date
						) as returned
					from last_before b
				)
				select
					-- Quiet for a whole day or more but not yet churned. Somebody
					-- active the day before the range never went away.
					count(*) filter (
						where days_quiet >= 2 and days_quiet <= ${churnInactivityDays}::int
					)::text as "lapsed",
					count(*) filter (
						where days_quiet >= 2 and days_quiet <= ${churnInactivityDays}::int and returned
					)::text as "reengaged",
					count(*) filter (where days_quiet > ${churnInactivityDays}::int)::text as "dormant",
					count(*) filter (
						where days_quiet > ${churnInactivityDays}::int and returned
					)::text as "reactivated"
				from pools
			`)
		).rows

		const known = Number(churn?.known ?? 0)
		const churned = Number(churn?.churned ?? 0)
		const lapsed = Number(returns?.lapsed ?? 0)
		const reengaged = Number(returns?.reengaged ?? 0)
		const dormant = Number(returns?.dormant ?? 0)
		const reactivated = Number(returns?.reactivated ?? 0)

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			churnInactivityDays,
			cohorts: cohortRows.map(row => this.toCohort(row, input.to)),
			knownUsers: known,
			churnedUsers: churned,
			churnRatePercent: this.rate(churned, known),
			lapsedAtRangeStart: lapsed,
			reengagedUsers: reengaged,
			reengagementRatePercent: this.rate(reengaged, lapsed),
			churnedAtRangeStart: dormant,
			reactivatedUsers: reactivated,
			reactivationRatePercent: this.rate(reactivated, dormant),
			averageLifetimeDays: this.number(churn?.averageLifetimeDays),
			medianLifetimeDays: this.number(churn?.medianLifetimeDays),
		}
	}

	private toCohort(
		row: { cohortDate: string; users: string; d1: string; d7: string; d30: string },
		to: string
	): Cohort {
		const users = Number(row.users)
		// Null, not zero: a cohort whose day N has not arrived yet has not failed
		// to come back, and 0% would report that it had.
		const point = (day: (typeof RETENTION_DAYS)[number], retained: string) =>
			this.hasElapsed(row.cohortDate, day, to)
				? { retainedUsers: Number(retained), percent: this.rate(Number(retained), users) }
				: null

		return {
			cohortDate: row.cohortDate,
			users,
			d1: point(1, row.d1),
			d7: point(7, row.d7),
			d30: point(30, row.d30),
		}
	}

	private hasElapsed(cohortDate: string, day: number, to: string): boolean {
		return Date.parse(`${cohortDate}T00:00:00Z`) + day * 86_400_000 <= Date.parse(`${to}T00:00:00Z`)
	}

	/** Zero rather than a division by zero: an empty pool has no rate. */
	private rate(part: number, whole: number): number {
		return whole === 0 ? 0 : this.round((part / whole) * 100)
	}

	private number(value: string | null | undefined): number | null {
		if (value === null || value === undefined) return null
		const parsed = Number(value)
		return Number.isFinite(parsed) ? this.round(parsed) : null
	}

	private round(value: number): number {
		return Math.round(value * 100) / 100
	}
}
