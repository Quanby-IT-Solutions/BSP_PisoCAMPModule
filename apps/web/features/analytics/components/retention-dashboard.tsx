"use client"

import type { CohortRetention } from "@repo/contracts"

import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useRetentionSummaryQuery } from "@/features/analytics/api/analytics.hooks"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

/**
 * A retention cell, or a plain statement that the day has not arrived.
 *
 * An em dash would read as "none came back"; the point of the null is that
 * nobody has had the chance to.
 */
function point(value: CohortRetention["d1"]) {
	if (value === null) return "Not yet"
	return `${decimal.format(value.percent)}% (${number.format(value.retainedUsers)})`
}

function days(value: number | null) {
	return value === null ? "No users yet" : `${decimal.format(value)} days`
}

export function RetentionDashboard({ from, to }: { from: string; to: string }) {
	const summary = useRetentionSummaryQuery({ from, to })

	if (summary.isPending) {
		return (
			<div role="status" aria-label="Loading retention" className="space-y-3">
				<Skeleton className="h-32 w-full" />
				<span className="sr-only">Loading retention</span>
			</div>
		)
	}
	if (summary.isError || !summary.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load retention</AlertTitle>
				<AlertDescription>
					Check your connection or access, then try again.
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => summary.refetch()}
					>
						Try Again
					</Button>
				</AlertDescription>
			</Alert>
		)
	}

	const data = summary.data

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Figure
					label="Churn rate"
					value={`${decimal.format(data.churnRatePercent)}%`}
					hint={`${number.format(data.churnedUsers)} of ${number.format(
						data.knownUsers
					)} quiet past ${number.format(data.churnInactivityDays)} days`}
				/>
				<Figure
					label="Re-engagement rate"
					value={`${decimal.format(data.reengagementRatePercent)}%`}
					hint={`${number.format(data.reengagedUsers)} of ${number.format(
						data.lapsedAtRangeStart
					)} lapsed at ${data.from}`}
				/>
				<Figure
					label="Reactivation rate"
					value={`${decimal.format(data.reactivationRatePercent)}%`}
					hint={`${number.format(data.reactivatedUsers)} of ${number.format(
						data.churnedAtRangeStart
					)} churned at ${data.from}`}
				/>
				<Figure
					label="Average lifetime"
					value={days(data.averageLifetimeDays)}
					hint={`Median ${days(data.medianLifetimeDays)}`}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Retention by cohort</CardTitle>
					<CardDescription>
						A cohort is everybody whose first ever activity fell on that day. Day 1, 7 and
						30 count a return on that day itself. &ldquo;Not yet&rdquo; means the day has
						not arrived within this report, which is not the same as nobody returning.
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					{data.cohorts.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No cohort started in this range.
						</p>
					) : (
						<table className="w-full min-w-0 text-sm">
							<caption className="sr-only">
								Day 1, day 7 and day 30 retention for each cohort
							</caption>
							<thead>
								<tr className="text-left">
									<th scope="col" className="py-2 pr-4">
										Cohort
									</th>
									<th scope="col" className="py-2 pr-4">
										Users
									</th>
									<th scope="col" className="py-2 pr-4">
										Day 1
									</th>
									<th scope="col" className="py-2 pr-4">
										Day 7
									</th>
									<th scope="col" className="py-2">
										Day 30
									</th>
								</tr>
							</thead>
							<tbody>
								{data.cohorts.map(cohort => (
									<tr key={cohort.cohortDate} className="border-t">
										<td className="py-2 pr-4">{cohort.cohortDate}</td>
										<td className="py-2 pr-4">{number.format(cohort.users)}</td>
										<td className="py-2 pr-4">{point(cohort.d1)}</td>
										<td className="py-2 pr-4">{point(cohort.d7)}</td>
										<td className="py-2">{point(cohort.d30)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle className="text-sm font-medium">{label}</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-2xl font-semibold">{value}</p>
				<p className="text-muted-foreground text-sm">{hint}</p>
			</CardContent>
		</Card>
	)
}
