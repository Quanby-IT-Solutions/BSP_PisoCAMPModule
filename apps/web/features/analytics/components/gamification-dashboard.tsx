"use client"

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
import { useGamificationSummaryQuery } from "@/features/analytics/api/analytics.hooks"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

export function GamificationDashboard({ from, to }: { from: string; to: string }) {
	const summary = useGamificationSummaryQuery({ from, to })

	if (summary.isPending) {
		return (
			<div role="status" aria-label="Loading gamification" className="space-y-3">
				<Skeleton className="h-32 w-full" />
				<span className="sr-only">Loading gamification</span>
			</div>
		)
	}
	if (summary.isError || !summary.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load gamification</AlertTitle>
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
	const { participation, topPerformers, trivia, reengagement } = data

	return (
		<div className="space-y-6">
			{!data.leaderboardEnabled ? (
				<Alert>
					<AlertTitle>The leaderboard is switched off</AlertTitle>
					<AlertDescription>
						Its figures below are zero because nobody can take part, not because
						nobody did.
					</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Figure
					label="Leaderboard participation"
					value={`${decimal.format(participation.participationRatePercent)}%`}
					hint={`${number.format(participation.participatingUsers)} of ${number.format(
						participation.eligibleUsers
					)} registered`}
				/>
				<Figure
					label="Top-performer retention"
					value={`${decimal.format(topPerformers.retentionRatePercent)}%`}
					hint={`${number.format(topPerformers.retainedTopUsers)} of ${number.format(
						topPerformers.previousTopUsers
					)} in the top ${topPerformers.topGroupPercent}%`}
				/>
				<Figure
					label="Trivia completion"
					value={`${decimal.format(trivia.completionRatePercent)}%`}
					hint={`${number.format(trivia.answered)} answered of ${number.format(
						trivia.promptsShown
					)} shown`}
				/>
				<Figure
					label="Learning re-engagement"
					value={`${decimal.format(reengagement.reengagementRatePercent)}%`}
					hint={`${number.format(
						reengagement.sessionsReturningToContent
					)} of ${number.format(reengagement.sessionsWithTrivia)} trivia sessions`}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Rank movement</CardTitle>
					<CardDescription>
						Against the previous period of the same kind. A new entrant has nobody to
						be compared with yet.
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					<table className="w-full min-w-0 text-sm">
						<caption className="sr-only">Rank movement since the previous period</caption>
						<thead>
							<tr className="text-left">
								<th scope="col" className="py-2 pr-4">
									Movement
								</th>
								<th scope="col" className="py-2">
									Users
								</th>
							</tr>
						</thead>
						<tbody>
							{[
								["Moved up", participation.movedUp],
								["Moved down", participation.movedDown],
								["Held station", participation.unchanged],
								["New entrants", participation.newEntrants],
							].map(([label, value]) => (
								<tr key={String(label)} className="border-t">
									<td className="py-2 pr-4">{label}</td>
									<td className="py-2">{number.format(Number(value))}</td>
								</tr>
							))}
						</tbody>
					</table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Trivia</CardTitle>
					<CardDescription>
						Skipped questions are not wrong answers, so they are left out of the
						accuracy.
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					<table className="w-full min-w-0 text-sm">
						<caption className="sr-only">Trivia participation</caption>
						<thead>
							<tr className="text-left">
								<th scope="col" className="py-2 pr-4">
									Measure
								</th>
								<th scope="col" className="py-2">
									Value
								</th>
							</tr>
						</thead>
						<tbody>
							{[
								["Prompts shown", number.format(trivia.promptsShown)],
								["Answered", number.format(trivia.answered)],
								["Skipped", number.format(trivia.skipped)],
								["Correct", number.format(trivia.correct)],
								["Incorrect", number.format(trivia.incorrect)],
								["Accuracy", `${decimal.format(trivia.accuracyPercent)}%`],
								["Participants", number.format(trivia.participants)],
								[
									"Came back another day",
									`${number.format(trivia.repeatParticipants)} (${decimal.format(
										trivia.repeatRatePercent
									)}%)`,
								],
								[
									"Content views after trivia",
									number.format(reengagement.contentViewsAfterTrivia),
								],
								[
									"Related links after trivia",
									number.format(reengagement.relatedLinkOpensAfterTrivia),
								],
								[
									"Engagement prompts after trivia",
									number.format(reengagement.engagementPromptsAfterTrivia),
								],
							].map(([label, value]) => (
								<tr key={String(label)} className="border-t">
									<td className="py-2 pr-4">{label}</td>
									<td className="py-2">{value}</td>
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
