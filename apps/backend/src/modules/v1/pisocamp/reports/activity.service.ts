import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import type { ActivitySummary, ReportFilters } from "@repo/contracts/pisocamp-report"

import { db } from "@/common/database/database.client"

import { eventFilters, eventRange } from "./report-filters"

const MANILA = "Asia/Manila"

@Injectable()
export class ActivityService {
	/**
	 * Event volume by name and by day.
	 *
	 * The KPI added alongside AN-8's framework: it exists to be the proof that
	 * a new report is a registry entry and a query, not a change to the way
	 * reports are run, recorded or audited.
	 */
	async summary(input: {
		from: string
		to: string
		filters: ReportFilters
	}): Promise<ActivitySummary> {
		const where = sql`${eventRange(input.from, input.to)} and ${eventFilters(input.filters)}`

		const [totals] = (
			await db.execute<{ events: string; users: string }>(sql`
				select count(*)::text as "events", count(distinct e.subject_pseudo_id)::text as "users"
				from analytics_event e
				where ${where}
			`)
		).rows

		const byEvent = (
			await db.execute<{ eventName: string; events: string; users: string }>(sql`
				select
					e.event_name as "eventName",
					count(*)::text as "events",
					count(distinct e.subject_pseudo_id)::text as "users"
				from analytics_event e
				where ${where}
				group by e.event_name
				order by count(*) desc, e.event_name asc
			`)
		).rows

		const byDay = (
			await db.execute<{ date: string; events: string }>(sql`
				select
					day::date::text as "date",
					count(e.event_id)::text as "events"
				from generate_series(${input.from}::date, ${input.to}::date, interval '1 day') as day
				left join analytics_event e
					on (e.occurred_at at time zone ${MANILA})::date = day::date
					and ${eventFilters(input.filters)}
				group by day
				order by day
			`)
		).rows

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			totalEvents: Number(totals?.events ?? 0),
			distinctUsers: Number(totals?.users ?? 0),
			byEvent: byEvent.map(row => ({
				eventName: row.eventName,
				events: Number(row.events),
				users: Number(row.users),
			})),
			byDay: byDay.map(row => ({ date: row.date, events: Number(row.events) })),
		}
	}
}
