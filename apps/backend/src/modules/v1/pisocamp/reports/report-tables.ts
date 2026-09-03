import type { ReportResult, ReportRun } from "@repo/contracts/pisocamp-report"

/**
 * A report reduced to titled tables.
 *
 * The three renderers write tables; the KPIs know how to become tables. Without
 * this in between, every new KPI would need writing three times — once per
 * format — and the formats would drift apart.
 */
export interface ReportTable {
	title: string
	columns: string[]
	rows: (string | number)[][]
}

type Cell = string | number

/** Null is "not measurable", and an export has to say so rather than print 0. */
function value(cell: number | null | undefined, suffix = ""): Cell {
	return cell === null || cell === undefined ? "not measurable" : `${cell}${suffix}`
}

function pairs(entries: [string, Cell][]): ReportTable {
	return { title: "Summary", columns: ["Measure", "Value"], rows: entries.map(([k, v]) => [k, v]) }
}

/**
 * How each KPI becomes tables.
 *
 * One entry per definition, beside the one in the registry and the one that
 * runs it. A KPI that forgot to add itself here exports its metadata and no
 * figures, which is why {@link reportTables} refuses rather than allowing that.
 */
const TABLES: { [K in ReportResult["definitionKey"]]: (result: never) => ReportTable[] } = {
	engagement: (result: Extract<ReportResult, { definitionKey: "engagement" }>) => {
		const summary = result.engagement
		return [
			pairs([
				["DAU", summary.dau],
				["MAU", summary.mau],
				["DAU / MAU %", summary.dauMauPercent],
				["Sessions", summary.sessions],
				["Active users", summary.activeUsers],
				["Sessions per user", summary.sessionsPerUser],
				["Average session (seconds)", summary.averageSessionSeconds],
				["Screen views per session", summary.screenViewsPerSession],
				["Session inactivity (minutes)", summary.sessionInactivityMinutes],
				[
					"Peak concurrent sessions",
					summary.peakConcurrency
						? `${summary.peakConcurrency.sessions} at ${summary.peakConcurrency.intervalStart}`
						: "no sessions were open",
				],
			]),
			{
				title: "Active users by day",
				columns: ["Date", "Active users"],
				rows: summary.dailyActive.map(day => [day.date, day.activeUsers]),
			},
			{
				title: "Sessions by hour",
				columns: ["Hour", "Sessions"],
				rows: summary.hourly.map(hour => [
					`${String(hour.hour).padStart(2, "0")}:00`,
					hour.sessions,
				]),
			},
		]
	},
	retention: (result: Extract<ReportResult, { definitionKey: "retention" }>) => {
		const summary = result.retention
		return [
			pairs([
				["Churn inactivity (days)", summary.churnInactivityDays],
				["Known users", summary.knownUsers],
				["Churned users", summary.churnedUsers],
				["Churn rate %", summary.churnRatePercent],
				["Lapsed at range start", summary.lapsedAtRangeStart],
				["Re-engaged users", summary.reengagedUsers],
				["Re-engagement rate %", summary.reengagementRatePercent],
				["Churned at range start", summary.churnedAtRangeStart],
				["Reactivated users", summary.reactivatedUsers],
				["Reactivation rate %", summary.reactivationRatePercent],
				["Average lifetime (days)", value(summary.averageLifetimeDays)],
				["Median lifetime (days)", value(summary.medianLifetimeDays)],
			]),
			{
				title: "Retention by cohort",
				columns: ["Cohort", "Users", "Day 1 %", "Day 7 %", "Day 30 %"],
				rows: summary.cohorts.map(cohort => [
					cohort.cohortDate,
					cohort.users,
					// "Not yet" rather than 0: the day has not arrived.
					cohort.d1 ? cohort.d1.percent : "not yet",
					cohort.d7 ? cohort.d7.percent : "not yet",
					cohort.d30 ? cohort.d30.percent : "not yet",
				]),
			},
		]
	},
	adoption: (result: Extract<ReportResult, { definitionKey: "adoption" }>) => {
		const summary = result.adoption
		return [
			pairs([
				["Prompted users", summary.promptedUsers],
				["Registered users", summary.registeredUsers],
				["Account creation rate %", summary.accountCreationRatePercent],
				["Entered users", summary.enteredUsers],
				["First-day activated users", summary.firstDayActivatedUsers],
				["First-day activation rate %", summary.firstDayActivationRatePercent],
				["Time to first key action, median (seconds)", value(
					summary.timeToFirstKeyActionMedianSeconds
				)],
				["Time to first key action, p95 (seconds)", value(
					summary.timeToFirstKeyActionP95Seconds
				)],
				["Key actions counted", summary.keyActionEvents.join(", ")],
			]),
			{
				title: "Feature usage",
				columns: ["Feature", "Uses", "Users"],
				rows: summary.features.map(feature => [feature.feature, feature.uses, feature.users]),
			},
		]
	},
	audit: (result: Extract<ReportResult, { definitionKey: "audit" }>) => {
		const report = result.audit
		return [
			pairs([
				["Entries", report.entryCount],
				[
					"Complete",
					report.truncated ? "No — more entries matched than one report carries" : "Yes",
				],
			]),
			{
				title: "Audit entries",
				columns: ["When", "Actor", "Action", "Outcome", "Target", "Before", "After", "Reason"],
				rows: report.entries.map(entry => [
					entry.at,
					entry.actor,
					entry.action,
					entry.outcome,
					entry.target,
					entry.before,
					entry.after,
					entry.reason,
				]),
			},
		]
	},
	activity: (result: Extract<ReportResult, { definitionKey: "activity" }>) => {
		const summary = result.activity
		return [
			pairs([
				["Total events", summary.totalEvents],
				["Distinct users", summary.distinctUsers],
			]),
			{
				title: "Events by name",
				columns: ["Event", "Events", "Users"],
				rows: summary.byEvent.map(entry => [entry.eventName, entry.events, entry.users]),
			},
			{
				title: "Events by day",
				columns: ["Date", "Events"],
				rows: summary.byDay.map(day => [day.date, day.events]),
			},
		]
	},
}

/**
 * The metadata every export carries, in the order §4.2-K names it.
 *
 * Stated once so all three formats show the same header, and so swapping in
 * BSP's approved template is a change to the renderers rather than to each of
 * them separately.
 */
export function reportHeader(run: ReportRun): [string, string][] {
	const filters = Object.entries(run.filters).filter(([, value]) => value !== undefined)

	return [
		["Report", run.definitionName],
		["Generated", run.generatedAt],
		["Generated by", run.generatedBy],
		["Period", `${run.from} to ${run.to} (${run.timezone})`],
		["Data source", run.dataSource],
		[
			"Parameters",
			filters.length === 0
				? "none"
				: filters.map(([key, value]) => `${key} = ${String(value)}`).join("; "),
		],
	]
}

/** The report's figures as tables, or none at all when it was withheld. */
export function reportTables(run: ReportRun): ReportTable[] {
	if (run.result === null) return []

	const build = TABLES[run.result.definitionKey] as (result: ReportResult) => ReportTable[]
	return build(run.result)
}
