"use client"

import type { AdoptionSummary } from "@repo/contracts"

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
import { useAdoptionSummaryQuery } from "@/features/analytics/api/analytics.hooks"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

const FEATURE_LABELS: Record<AdoptionSummary["features"][number]["feature"], string> = {
	currency_education: "Currency education",
	banknotes: "Banknotes",
	coins: "Coins",
	"3d_coin": "3D coin viewer",
	haptic: "Haptic",
	tilt: "Tilt",
	zoom_pan: "Zoom and pan",
	trivia: "Trivia",
	leaderboard: "Leaderboard",
	ar: "AR",
	recognition: "Recognition",
	survey: "Surveys",
	advisory: "Advisory",
	external_link: "External links",
	internal_link: "Internal links",
}

/** Seconds as something a reader can act on. */
function duration(seconds: number | null) {
	if (seconds === null) return "No key action yet"
	const whole = Math.round(seconds)
	if (whole < 60) return `${whole}s`
	const minutes = Math.floor(whole / 60)
	if (minutes < 60) return `${minutes}m ${String(whole % 60).padStart(2, "0")}s`
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function AdoptionDashboard({ from, to }: { from: string; to: string }) {
	const summary = useAdoptionSummaryQuery({ from, to })

	if (summary.isPending) {
		return (
			<div role="status" aria-label="Loading adoption" className="space-y-3">
				<Skeleton className="h-32 w-full" />
				<span className="sr-only">Loading adoption</span>
			</div>
		)
	}
	if (summary.isError || !summary.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load adoption</AlertTitle>
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
					label="Account creation rate"
					value={`${decimal.format(data.accountCreationRatePercent)}%`}
					hint={`${number.format(data.registeredUsers)} of ${number.format(
						data.promptedUsers
					)} prompted`}
				/>
				<Figure
					label="First-day activation"
					value={`${decimal.format(data.firstDayActivationRatePercent)}%`}
					hint={`${number.format(data.firstDayActivatedUsers)} of ${number.format(
						data.enteredUsers
					)} who entered`}
				/>
				<Figure
					label="Time to first key action"
					value={duration(data.timeToFirstKeyActionMedianSeconds)}
					hint="Median"
				/>
				<Figure
					label="Time to first key action"
					value={duration(data.timeToFirstKeyActionP95Seconds)}
					hint="95th percentile"
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Feature usage</CardTitle>
					<CardDescription>
						Key actions counted: {data.keyActionEvents.join(", ")}. A feature with no uses
						may not be built yet.
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					<table className="w-full min-w-0 text-sm">
						<caption className="sr-only">Uses and users for each feature</caption>
						<thead>
							<tr className="text-left">
								<th scope="col" className="py-2 pr-4">
									Feature
								</th>
								<th scope="col" className="py-2 pr-4">
									Uses
								</th>
								<th scope="col" className="py-2">
									Users
								</th>
							</tr>
						</thead>
						<tbody>
							{data.features.map(feature => (
								<tr key={feature.feature} className="border-t">
									<td className="py-2 pr-4">{FEATURE_LABELS[feature.feature]}</td>
									<td className="py-2 pr-4">{number.format(feature.uses)}</td>
									<td className="py-2">{number.format(feature.users)}</td>
								</tr>
							))}
						</tbody>
					</table>
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
