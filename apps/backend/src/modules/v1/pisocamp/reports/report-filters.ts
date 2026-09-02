import { sql, type SQL } from "drizzle-orm"

import type { ReportFilters } from "@repo/contracts/pisocamp-report"

const MANILA = "Asia/Manila"

/**
 * How each approved filter narrows a row of `analytics_event`.
 *
 * Declared rather than written out, so a report that says it supports a filter
 * and a filter that knows how to narrow the data are the same list. A filter
 * with no entry here is one no report can claim to support.
 */
const EVENT_COLUMNS = {
	appVersion: sql`e.app_version`,
	feature: sql`e.feature`,
	userType: sql`e.account_type`,
	device: sql`e.device_category`,
	os: sql`e.os_name`,
	activityType: sql`e.event_name`,
} as const

export type EventFilterKey = keyof typeof EVENT_COLUMNS

/** The Manila days a report covers, as a predicate on `occurred_at`. */
export function eventRange(from: string, to: string): SQL {
	return sql`
		e.occurred_at >= ((${from}::date)::timestamp at time zone ${MANILA})
		and e.occurred_at < (((${to}::date + 1)::timestamp) at time zone ${MANILA})
	`
}

/**
 * The filters, as one predicate.
 *
 * `true` when nothing was asked for, so a caller can always `and` it in and
 * never has to know whether any filter was set.
 */
export function eventFilters(filters: ReportFilters): SQL {
	const clauses = Object.entries(EVENT_COLUMNS)
		.map(([key, column]) => {
			const value = filters[key as EventFilterKey]
			return value === undefined ? null : sql`${column} = ${value}`
		})
		.filter((clause): clause is SQL => clause !== null)

	if (clauses.length === 0) return sql`true`
	return sql.join(clauses, sql` and `)
}

/** Which filters were actually asked for, for the report to say so. */
export function namedFilters(filters: ReportFilters): string[] {
	return Object.entries(filters)
		.filter(([, value]) => value !== undefined)
		.map(([key]) => key)
}
