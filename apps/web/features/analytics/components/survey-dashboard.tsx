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
import { useSurveyMetricsQuery } from "@/features/analytics/api/analytics.hooks"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

function score(value: number | null) {
	return value === null ? "No answers yet" : decimal.format(value)
}

export function SurveyDashboard({ from, to }: { from: string; to: string }) {
	const summary = useSurveyMetricsQuery({ from, to })

	if (summary.isPending) {
		return (
			<div role="status" aria-label="Loading survey results" className="space-y-3">
				<Skeleton className="h-32 w-full" />
				<span className="sr-only">Loading survey results</span>
			</div>
		)
	}
	if (summary.isError || !summary.data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Could not load survey results</AlertTitle>
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
					label="Responses"
					value={number.format(data.totalResponses)}
					hint={`${number.format(data.consent.granted)} on a standing grant`}
				/>
				<Figure
					label="Average rating"
					value={score(data.overallAverageRating)}
					hint="Out of 5, skipped questions excluded"
				/>
				<Figure
					label="Net promoter score"
					value={score(data.overallNps.score)}
					hint={`${decimal.format(data.overallNps.promoterPercent)}% promoters less ${decimal.format(
						data.overallNps.detractorPercent
					)}% detractors`}
				/>
				<Figure
					label="Withdrawn consent"
					value={number.format(data.consent.withdrawn)}
					hint="Responses whose grant was later taken back"
				/>
			</div>

			{!data.storeRatingsAvailable ? (
				<Alert>
					<AlertTitle>In-app answers only</AlertTitle>
					<AlertDescription>
						App store ratings are not imported yet, so these figures are what people
						told the module, not everything people have said about it.
					</AlertDescription>
				</Alert>
			) : null}

			{data.surveys.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No survey was answered in this range.
				</p>
			) : (
				data.surveys.map(survey => (
					<Card key={survey.contentItemId}>
						<CardHeader>
							<CardTitle>{survey.title}</CardTitle>
							<CardDescription>
								{number.format(survey.responses)} of{" "}
								{number.format(survey.promptsShown)} shown answered (
								{decimal.format(survey.completionRatePercent)}%),{" "}
								{number.format(survey.declined)} declined. Average rating{" "}
								{score(survey.averageRating)}.
							</CardDescription>
						</CardHeader>
						<CardContent className="min-w-0 space-y-6 overflow-x-auto">
							{survey.questions.map(question => (
								<div key={question.questionId} className="min-w-0 space-y-2">
									<h3 className="text-sm font-medium">{question.prompt}</h3>
									<p className="text-muted-foreground text-sm">
										{number.format(question.answered)} answered,{" "}
										{number.format(question.skipped)} skipped
										{question.average === null
											? ""
											: `, average ${decimal.format(question.average)}`}
										{question.nps === null
											? ""
											: `, NPS ${score(question.nps.score)}`}
									</p>
									{question.distribution.length > 0 ? (
										<table className="w-full min-w-0 text-sm">
											<caption className="sr-only">
												How {question.prompt} was answered
											</caption>
											<thead>
												<tr className="text-left">
													<th scope="col" className="py-1 pr-4">
														Answer
													</th>
													<th scope="col" className="py-1">
														Responses
													</th>
												</tr>
											</thead>
											<tbody>
												{question.distribution.map(point => (
													<tr key={point.value} className="border-t">
														<td className="py-1 pr-4">{point.value}</td>
														<td className="py-1">
															{number.format(point.responses)} (
															{decimal.format(point.percent)}%)
														</td>
													</tr>
												))}
											</tbody>
										</table>
									) : null}
								</div>
							))}
						</CardContent>
					</Card>
				))
			)}
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
