"use client"

import { useState } from "react"

import type {
	DemographicDistribution,
	DemographicMeasure,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
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
import {
	useDemographicDrilldownQuery,
	useDemographicsSummaryQuery,
} from "@/features/analytics/api/analytics.hooks"
import {
	AnalyticsRangeCard,
	daysBefore,
	manilaToday,
} from "@/features/analytics/components/analytics-range-card"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

const DIMENSION_LABELS: Record<string, string> = {
	ageGroup: "Age group",
	gender: "Gender",
	region: "Region",
	city: "City",
}

const UNIT_LABELS: Record<string, string> = {
	users: "Daily active users",
	seconds: "Average session (seconds)",
	percent: "Percent",
}

function withheld(minimum: number) {
	return `Withheld (fewer than ${minimum})`
}

export function DemographicsDashboard({ canViewPii }: { canViewPii: boolean }) {
	const today = manilaToday()
	const [range, setRange] = useState({ from: daysBefore(today, 29), to: today })
	const summary = useDemographicsSummaryQuery(range)
	const [open, setOpen] = useState<{ dimension: string; bucketKey: string } | null>(null)

	return (
		<div className="space-y-6">
			<PageHeader
				title="Demographics"
				description="Aggregate cuts of usage and retention, from profiles that consented to demographic analytics."
			/>

			<AnalyticsRangeCard idPrefix="demographics" initial={range} onApply={setRange} />

			{summary.isPending ? (
				<div role="status" aria-label="Loading demographics" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading demographics</span>
				</div>
			) : summary.isError || !summary.data ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load demographics</AlertTitle>
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
			) : (
				<>
					<Alert>
						<AlertTitle>Consent decides who is counted</AlertTitle>
						<AlertDescription>
							{number.format(summary.data.consentedUsers)} profiles consented to
							demographic analytics and are in these cuts.{" "}
							{number.format(summary.data.withoutConsentUsers)} did not and appear in
							none of them, though their activity still counts towards the ordinary
							KPIs. Any group smaller than {summary.data.suppressionMinimum} is
							withheld.
						</AlertDescription>
					</Alert>

					{summary.data.distributions.map(distribution => (
						<Distribution
							key={distribution.dimension}
							distribution={distribution}
							minimum={summary.data.suppressionMinimum}
							canViewPii={canViewPii}
							onOpen={bucketKey =>
								setOpen({ dimension: distribution.dimension, bucketKey })
							}
						/>
					))}

					<Measure
						title="Daily active users by gender"
						measure={summary.data.dauByGender}
						minimum={summary.data.suppressionMinimum}
					/>
					<Measure
						title="Session duration by gender"
						measure={summary.data.sessionDurationByGender}
						minimum={summary.data.suppressionMinimum}
					/>
					{summary.data.retention.map(measure => (
						<Measure
							key={`retention-${measure.dimension}`}
							title={`Day-7 retention by ${DIMENSION_LABELS[measure.dimension]?.toLowerCase()}`}
							measure={measure}
							minimum={summary.data.suppressionMinimum}
						/>
					))}
					{summary.data.churn.map(measure => (
						<Measure
							key={`churn-${measure.dimension}`}
							title={`Churn by ${DIMENSION_LABELS[measure.dimension]?.toLowerCase()}`}
							measure={measure}
							minimum={summary.data.suppressionMinimum}
						/>
					))}

					{canViewPii && open ? (
						<Drilldown
							from={range.from}
							to={range.to}
							dimension={open.dimension}
							bucketKey={open.bucketKey}
							onClose={() => setOpen(null)}
						/>
					) : null}
				</>
			)}
		</div>
	)
}

function Distribution({
	distribution,
	minimum,
	canViewPii,
	onOpen,
}: {
	distribution: DemographicDistribution
	minimum: number
	canViewPii: boolean
	onOpen: (bucketKey: string) => void
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{DIMENSION_LABELS[distribution.dimension] ?? distribution.dimension}</CardTitle>
				<CardDescription>
					{number.format(distribution.totalUsers)} consented profiles;{" "}
					{number.format(distribution.suppressedBuckets)} group
					{distribution.suppressedBuckets === 1 ? "" : "s"} withheld.
				</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 overflow-x-auto">
				<table className="w-full min-w-0 text-sm">
					<caption className="sr-only">
						Distribution by {DIMENSION_LABELS[distribution.dimension]}
					</caption>
					<thead>
						<tr className="text-left">
							<th scope="col" className="py-2 pr-4">
								Group
							</th>
							<th scope="col" className="py-2 pr-4">
								People
							</th>
							<th scope="col" className="py-2">
								Share
							</th>
							{canViewPii ? (
								<th scope="col" className="py-2">
									Detail
								</th>
							) : null}
						</tr>
					</thead>
					<tbody>
						{distribution.buckets.map(bucket => (
							<tr key={bucket.key} className="border-t">
								<td className="py-2 pr-4">{bucket.label}</td>
								<td className="py-2 pr-4">
									{bucket.suppressed ? withheld(minimum) : number.format(bucket.users ?? 0)}
								</td>
								<td className="py-2">
									{bucket.suppressed ? "—" : `${decimal.format(bucket.percent ?? 0)}%`}
								</td>
								{canViewPii ? (
									<td className="py-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="min-h-11"
											onClick={() => onOpen(bucket.key)}
										>
											Open {bucket.label}
										</Button>
									</td>
								) : null}
							</tr>
						))}
					</tbody>
				</table>
			</CardContent>
		</Card>
	)
}

function Measure({
	title,
	measure,
	minimum,
}: {
	title: string
	measure: DemographicMeasure
	minimum: number
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{UNIT_LABELS[measure.unit] ?? measure.unit}</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 overflow-x-auto">
				<table className="w-full min-w-0 text-sm">
					<caption className="sr-only">{title}</caption>
					<thead>
						<tr className="text-left">
							<th scope="col" className="py-2 pr-4">
								Group
							</th>
							<th scope="col" className="py-2 pr-4">
								People
							</th>
							<th scope="col" className="py-2">
								Value
							</th>
						</tr>
					</thead>
					<tbody>
						{measure.rows.length === 0 ? (
							<tr className="border-t">
								<td className="text-muted-foreground py-2" colSpan={3}>
									Nobody in this cut yet.
								</td>
							</tr>
						) : (
							measure.rows.map(row => (
								<tr key={row.key} className="border-t">
									<td className="py-2 pr-4">{row.label}</td>
									<td className="py-2 pr-4">
										{row.suppressed ? withheld(minimum) : number.format(row.users ?? 0)}
									</td>
									<td className="py-2">
										{row.suppressed
											? "—"
											: measure.unit === "percent"
												? `${decimal.format(row.value ?? 0)}%`
												: decimal.format(row.value ?? 0)}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</CardContent>
		</Card>
	)
}

/**
 * §4.2-M's drill-down.
 *
 * Only mounted for a holder of `reports.pii.view`, and every open of it is
 * audited on the server: reading who is in a group is a different act from
 * reading how many people are in it.
 */
function Drilldown({
	from,
	to,
	dimension,
	bucketKey,
	onClose,
}: {
	from: string
	to: string
	dimension: string
	bucketKey: string
	onClose: () => void
}) {
	const drilldown = useDemographicDrilldownQuery({
		from,
		to,
		dimension: dimension as "ageGroup" | "gender" | "region" | "city",
		bucketKey,
		limit: 50,
	})

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{DIMENSION_LABELS[dimension] ?? dimension}: {bucketKey}
				</CardTitle>
				<CardDescription>
					Row-level data. Every open of this panel is recorded against your account.
				</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 space-y-4 overflow-x-auto">
				{drilldown.isPending ? (
					<div role="status" aria-label="Loading people">
						<Skeleton className="h-24 w-full" />
						<span className="sr-only">Loading people</span>
					</div>
				) : drilldown.isError || !drilldown.data ? (
					<Alert variant="destructive">
						<AlertTitle>Could not load the detail</AlertTitle>
						<AlertDescription>You may not have access to row-level data.</AlertDescription>
					</Alert>
				) : (
					<table className="w-full min-w-0 text-sm">
						<caption className="sr-only">
							People in {DIMENSION_LABELS[dimension]} {bucketKey}
						</caption>
						<thead>
							<tr className="text-left">
								<th scope="col" className="py-2 pr-4">
									Name
								</th>
								<th scope="col" className="py-2 pr-4">
									Email
								</th>
								<th scope="col" className="py-2 pr-4">
									Age
								</th>
								<th scope="col" className="py-2 pr-4">
									Place
								</th>
								<th scope="col" className="py-2">
									Active days
								</th>
							</tr>
						</thead>
						<tbody>
							{drilldown.data.rows.map(row => (
								<tr key={row.accountId} className="border-t">
									<td className="py-2 pr-4">{row.name}</td>
									<td className="py-2 pr-4">{row.email}</td>
									<td className="py-2 pr-4">{row.age}</td>
									<td className="py-2 pr-4">
										{row.cityCode}, {row.regionCode}
									</td>
									<td className="py-2">{number.format(row.activeDays)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
					Close Detail
				</Button>
			</CardContent>
		</Card>
	)
}
