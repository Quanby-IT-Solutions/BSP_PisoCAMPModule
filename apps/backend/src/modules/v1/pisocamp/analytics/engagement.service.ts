import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"

const MANILA = "Asia/Manila"

type Summary = V1Outputs["pisocamp"]["analytics"]["engagement"]

@Injectable()
export class EngagementService {
	constructor(private readonly adminConfig: PisoCampAdminConfigService) {}

	/**
	 * The engagement figures for a range of Asia/Manila days.
	 *
	 * Every figure is derived from `analytics_session`, which AN-2's sessioniser
	 * builds from the raw events. A dashboard that recomputed them from events
	 * on the fly would answer a slightly different question each time the
	 * inactivity setting moved.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["engagement"]
	): Promise<Summary> {
		const sessionInactivityMinutes = (await this.adminConfig.get())
			.session_inactivity_minutes

		const [totals] = (
			await db.execute<{
				sessions: string
				activeUsers: string
				averageSessionSeconds: string | null
				screenViews: string | null
				events: string | null
			}>(sql`
				select
					count(*)::text as "sessions",
					count(distinct subject_pseudo_id)::text as "activeUsers",
					avg(duration_seconds)::text as "averageSessionSeconds",
					sum(screen_view_count)::text as "screenViews",
					sum(event_count)::text as "events"
				from analytics_session
				where local_date between ${input.from}::date and ${input.to}::date
			`)
		).rows

		const [reach] = (
			await db.execute<{ dau: string; mau: string }>(sql`
				select
					(
						select count(distinct subject_pseudo_id)::text
						from analytics_session
						where local_date = ${input.to}::date
					) as "dau",
					(
						select count(distinct subject_pseudo_id)::text
						from analytics_session
						-- Rolling 30 days ending on the last day of the range,
						-- inclusive of both ends: 30 days, not 31.
						where local_date > ${input.to}::date - 30
							and local_date <= ${input.to}::date
					) as "mau"
			`)
		).rows

		const dailyActive = (
			await db.execute<{ date: string; activeUsers: string }>(sql`
				select
					day::date::text as "date",
					coalesce(count(distinct s.subject_pseudo_id), 0)::text as "activeUsers"
				from generate_series(${input.from}::date, ${input.to}::date, interval '1 day') as day
				left join analytics_session s on s.local_date = day::date
				group by day
				order by day
			`)
		).rows

		const hourly = (
			await db.execute<{ hour: string; sessions: string }>(sql`
				select
					hour::int::text as "hour",
					coalesce(count(s.id), 0)::text as "sessions"
				from generate_series(0, 23) as hour
				left join analytics_session s
					on extract(hour from (s.started_at at time zone ${MANILA}))::int = hour
					and s.local_date between ${input.from}::date and ${input.to}::date
				group by hour
				order by hour
			`)
		).rows

		const [peak] = (
			await db.execute<{ intervalStart: string; sessions: string }>(sql`
				with bounds as (
					select
						((${input.from}::date)::timestamp at time zone ${MANILA}) as window_start,
						(((${input.to}::date + 1)::timestamp) at time zone ${MANILA}) as window_end
				), slots as (
					select generate_series(window_start, window_end - interval '5 minutes',
						interval '5 minutes') as slot_start
					from bounds
				)
				select
					to_char(slots.slot_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
						as "intervalStart",
					count(s.id)::text as "sessions"
				from slots
				left join analytics_session s
					-- Open during the interval, which is not the same as started in
					-- it: a long session is concurrent with every slot it spans.
					on s.started_at < slots.slot_start + interval '5 minutes'
					and s.ended_at >= slots.slot_start
				group by slots.slot_start
				having count(s.id) > 0
				order by count(s.id) desc, slots.slot_start asc
				limit 1
			`)
		).rows

		const sessions = Number(totals?.sessions ?? 0)
		const activeUsers = Number(totals?.activeUsers ?? 0)
		const dau = Number(reach?.dau ?? 0)
		const mau = Number(reach?.mau ?? 0)
		const screenViews = Number(totals?.screenViews ?? 0)

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			sessionInactivityMinutes,
			dau,
			mau,
			// Zero rather than a division by zero: a period with no monthly
			// users has no ratio, and reporting one would be a fiction.
			dauMauPercent: mau === 0 ? 0 : this.round((dau / mau) * 100),
			sessions,
			activeUsers,
			sessionsPerUser: activeUsers === 0 ? 0 : this.round(sessions / activeUsers),
			averageSessionSeconds: this.round(Number(totals?.averageSessionSeconds ?? 0)),
			screenViewsPerSession: sessions === 0 ? 0 : this.round(screenViews / sessions),
			dailyActive: dailyActive.map(row => ({
				date: row.date,
				activeUsers: Number(row.activeUsers),
			})),
			hourly: hourly.map(row => ({
				hour: Number(row.hour),
				sessions: Number(row.sessions),
			})),
			peakConcurrency: peak
				? { intervalStart: peak.intervalStart, sessions: Number(peak.sessions) }
				: null,
		}
	}

	/** Two decimals, so a reported figure is the one a reader can reproduce. */
	private round(value: number): number {
		return Math.round(value * 100) / 100
	}
}
