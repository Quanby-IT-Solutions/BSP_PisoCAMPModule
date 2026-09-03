"use client"

import { useState } from "react"

import type { EngagementSummary } from "@repo/contracts"

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
import { useEngagementSummaryQuery } from "@/features/analytics/api/analytics.hooks"
import { AdoptionDashboard } from "@/features/analytics/components/adoption-dashboard"
import {
	AnalyticsRangeCard,
	daysBefore,
	manilaToday,
} from "@/features/analytics/components/analytics-range-card"
import { GamificationDashboard } from "@/features/analytics/components/gamification-dashboard"
import { RetentionDashboard } from "@/features/analytics/components/retention-dashboard"
import { SurveyDashboard } from "@/features/analytics/components/survey-dashboard"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

/** Seconds as minutes and seconds, because "1,320 seconds" is not a duration. */
function duration(seconds: number) {
	const whole = Math.round(seconds)
	const minutes = Math.floor(whole / 60)
	return `${minutes}m ${String(whole % 60).padStart(2, "0")}s`
}

export function EngagementDashboard() {
	const today = manilaToday()
	const [range, setRange] = useState({ from: daysBefore(today, 29), to: today })
	const summary = useEngagementSummaryQuery(range)

	return (
		<div className="space-y-6">
			<PageHeader
				title="Engagement"
				description="Sessions and engagement KPIs, by Asia/Manila day."
			/>

			<AnalyticsRangeCard idPrefix="engagement" initial={range} onApply={setRange} />

			{summary.isPending ? (
				<div role="status" aria-label="Loading engagement" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading engagement</span>
				</div>
			) : summary.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load engagement</AlertTitle>
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
			) : summary.data ? (
				<EngagementFigures summary={summary.data} />
			) : null}

			<h2 className="text-xl font-semibold">Adoption</h2>
			<AdoptionDashboard from={range.from} to={range.to} />

			<h2 className="text-xl font-semibold">Retention</h2>
			<RetentionDashboard from={range.from} to={range.to} />

			<h2 className="text-xl font-semibold">Gamification</h2>
			<GamificationDashboard from={range.from} to={range.to} />

			<h2 className="text-xl font-semibold">Surveys</h2>
			<SurveyDashboard from={range.from} to={range.to} />
		</div>
	)
}

function EngagementFigures({ summary }: { summary: EngagementSummary }) {
	const figures: { label: string; value: string; hint?: string }[] = [
		{ label: "DAU", value: number.format(summary.dau), hint: `On ${summary.to}` },
		{ label: "MAU", value: number.format(summary.mau), hint: "Rolling 30 days" },
		{ label: "DAU / MAU", value: `${decimal.format(summary.dauMauPercent)}%` },
		{ label: "Sessions", value: number.format(summary.sessions) },
		{ label: "Active users", value: number.format(summary.activeUsers) },
		{ label: "Sessions per user", value: decimal.format(summary.sessionsPerUser) },
		{ label: "Average session", value: duration(summary.averageSessionSeconds) },
		{
			label: "Screen views per session",
			value: decimal.format(summary.screenViewsPerSession),
		},
	]
	const busiestHour = summary.hourly.reduce(
		(best, entry) => (entry.sessions > best.sessions ? entry : best),
		summary.hourly[0] ?? { hour: 0, sessions: 0 }
	)

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{figures.map(figure => (
					<Card key={figure.label} className="min-w-0">
						<CardHeader>
							<CardTitle className="text-sm font-medium">{figure.label}</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-2xl font-semibold">{figure.value}</p>
							{figure.hint ? (
								<p className="text-muted-foreground text-sm">{figure.hint}</p>
							) : null}
						</CardContent>
					</Card>
				))}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Peak activity</CardTitle>
					<CardDescription>
						A session gap of {summary.sessionInactivityMinutes} minutes ends a session.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					<p>
						Busiest hour: <strong>{String(busiestHour.hour).padStart(2, "0")}:00</strong> with{" "}
						{number.format(busiestHour.sessions)} sessions.
					</p>
					<p>
						{summary.peakConcurrency
							? `Most sessions open at once: ${number.format(
									summary.peakConcurrency.sessions
								)}.`
							: "No sessions were open in this range."}
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active users by day</CardTitle>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					<table className="w-full min-w-0 text-sm">
						<caption className="sr-only">Active users for each day in the range</caption>
						<thead>
							<tr className="text-left">
								<th scope="col" className="py-2 pr-4">
									Date
								</th>
								<th scope="col" className="py-2">
									Active users
								</th>
							</tr>
						</thead>
						<tbody>
							{summary.dailyActive.map(day => (
								<tr key={day.date} className="border-t">
									<td className="py-2 pr-4">{day.date}</td>
									<td className="py-2">{number.format(day.activeUsers)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</CardContent>
			</Card>
		</div>
	)
}
