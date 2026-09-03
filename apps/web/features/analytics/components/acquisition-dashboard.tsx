"use client"

import { useState, type ChangeEvent, type FormEvent } from "react"

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
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { Textarea } from "@/core/components/ui/textarea"
import {
	useAcquisitionSummaryQuery,
	useImportStoreMetricsMutation,
} from "@/features/analytics/api/analytics.hooks"
import {
	AnalyticsRangeCard,
	daysBefore,
	manilaToday,
} from "@/features/analytics/components/analytics-range-card"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

const SOURCE_LABELS: Record<string, string> = {
	google_play: "Google Play",
	app_store: "App Store",
}

const CSV_HEADER = "source,periodStart,periodEnd,installs,uninstalls,ratingAverage,ratingCount"

export interface StoreMetricRow {
	source: "google_play" | "app_store"
	periodStart: string
	periodEnd: string
	installs: number
	uninstalls: number
	ratingAverage: number | null
	ratingCount: number | null
}

/**
 * Parse the store's CSV export into the rows the import accepts.
 *
 * Exported so the parsing rules can be tested on their own: a silent
 * mis-parse would put a wrong install count in front of somebody as though the
 * store had said it.
 */
export function parseStoreCsv(text: string): { rows: StoreMetricRow[]; error: string | null } {
	const lines = text
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0)
	if (lines.length === 0) return { rows: [], error: "The file is empty." }

	const header = lines[0]!.replace(/\s+/g, "")
	if (header !== CSV_HEADER) {
		return { rows: [], error: `The first line must be exactly: ${CSV_HEADER}` }
	}

	const rows: StoreMetricRow[] = []
	for (const [index, line] of lines.slice(1).entries()) {
		const cells = line.split(",").map(cell => cell.trim())
		if (cells.length !== 7) {
			return { rows: [], error: `Line ${index + 2} does not have seven columns.` }
		}
		const [source, periodStart, periodEnd, installs, uninstalls, average, count] = cells
		if (source !== "google_play" && source !== "app_store") {
			return { rows: [], error: `Line ${index + 2} names an unknown store: ${source}` }
		}
		const parsed: StoreMetricRow = {
			source,
			periodStart: periodStart!,
			periodEnd: periodEnd!,
			installs: Number(installs),
			uninstalls: Number(uninstalls),
			// An empty rating column is a period the store reported no rating
			// for, which is different from a rating of zero.
			ratingAverage: average === "" ? null : Number(average),
			ratingCount: count === "" ? null : Number(count),
		}
		if (
			!Number.isFinite(parsed.installs) ||
			!Number.isFinite(parsed.uninstalls) ||
			(parsed.ratingAverage !== null && !Number.isFinite(parsed.ratingAverage)) ||
			(parsed.ratingCount !== null && !Number.isFinite(parsed.ratingCount))
		) {
			return { rows: [], error: `Line ${index + 2} has a value that is not a number.` }
		}
		rows.push(parsed)
	}

	return rows.length === 0
		? { rows: [], error: "The file has a header and no rows." }
		: { rows, error: null }
}

export function AcquisitionDashboard({ canImport }: { canImport: boolean }) {
	const today = manilaToday()
	const [range, setRange] = useState({ from: daysBefore(today, 29), to: today })
	const summary = useAcquisitionSummaryQuery(range)

	return (
		<div className="space-y-6">
			<PageHeader
				title="Acquisition"
				description="Install volume and ratings, from the stores and from the module itself."
			/>

			<AnalyticsRangeCard idPrefix="acquisition" initial={range} onApply={setRange} />

			{summary.isPending ? (
				<div role="status" aria-label="Loading acquisition" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading acquisition</span>
				</div>
			) : summary.isError || !summary.data ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load acquisition</AlertTitle>
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
					<Card>
						<CardHeader>
							<CardTitle>Install volume</CardTitle>
							<CardDescription>{summary.data.installVolume.sourceLabel}</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<Figure
								label="Installs"
								value={
									summary.data.installVolume.headlineInstalls === null
										? "No data"
										: number.format(summary.data.installVolume.headlineInstalls)
								}
								hint={summary.data.installVolume.sourceLabel}
							/>
							<Figure
								label="First opens (devices)"
								value={number.format(summary.data.installVolume.firstOpenDevices)}
								hint="Devices that opened the module for the first time"
							/>
							<Figure
								label="Store uninstalls"
								value={number.format(summary.data.installVolume.storeUninstalls)}
								hint="As the stores reported them"
							/>
						</CardContent>
						<CardContent>
							<Alert>
								<AlertTitle>The two counts are not added together</AlertTitle>
								<AlertDescription>
									A store counts downloads and the module counts devices that opened
									it. Adding them would count every install that was opened twice, so
									they are shown side by side.
								</AlertDescription>
							</Alert>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Ratings</CardTitle>
							<CardDescription>
								The combined average is weighted by how many ratings each side has.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<Figure
								label="In-app"
								value={
									summary.data.ratings.inAppAverage === null
										? "No answers yet"
										: decimal.format(summary.data.ratings.inAppAverage)
								}
								hint={`${number.format(summary.data.ratings.inAppResponses)} answers`}
							/>
							<Figure
								label="Stores"
								value={
									summary.data.ratings.storeAverage === null
										? "No ratings imported"
										: decimal.format(summary.data.ratings.storeAverage)
								}
								hint={`${number.format(summary.data.ratings.storeRatings)} ratings`}
							/>
							<Figure
								label="Combined"
								value={
									summary.data.ratings.combinedAverage === null
										? "Nothing to combine"
										: decimal.format(summary.data.ratings.combinedAverage)
								}
								hint={`${number.format(summary.data.ratings.combinedRatings)} ratings in total`}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>By store</CardTitle>
							<CardDescription>
								{summary.data.storeDataAvailable
									? "Imported from each store's own reporting."
									: "No store report covers this range."}
							</CardDescription>
						</CardHeader>
						<CardContent className="min-w-0 space-y-6 overflow-x-auto">
							{summary.data.stores.length > 0 ? (
								<table className="w-full min-w-0 text-sm">
									<caption className="sr-only">Figures reported by each store</caption>
									<thead>
										<tr className="text-left">
											<th scope="col" className="py-2 pr-4">
												Store
											</th>
											<th scope="col" className="py-2 pr-4">
												Installs
											</th>
											<th scope="col" className="py-2 pr-4">
												Uninstalls
											</th>
											<th scope="col" className="py-2 pr-4">
												Rating
											</th>
											<th scope="col" className="py-2">
												Periods
											</th>
										</tr>
									</thead>
									<tbody>
										{summary.data.stores.map(store => (
											<tr key={store.source} className="border-t">
												<td className="py-2 pr-4">
													{SOURCE_LABELS[store.source] ?? store.source}
												</td>
												<td className="py-2 pr-4">{number.format(store.installs)}</td>
												<td className="py-2 pr-4">{number.format(store.uninstalls)}</td>
												<td className="py-2 pr-4">
													{store.ratingAverage === null
														? "None reported"
														: `${decimal.format(store.ratingAverage)} (${number.format(
																store.ratingCount ?? 0
															)})`}
												</td>
												<td className="py-2">{number.format(store.periods)}</td>
											</tr>
										))}
									</tbody>
								</table>
							) : null}

							{canImport ? <StoreImportForm /> : null}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}

/** The upload form AN-11 asks for: a store's CSV export, parsed here. */
function StoreImportForm() {
	const importRows = useImportStoreMetricsMutation()
	const [text, setText] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState<string | null>(null)

	async function onFile(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0]
		if (!file) return
		setText(await file.text())
		setError(null)
		setSaved(null)
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const parsed = parseStoreCsv(text)
		if (parsed.error) {
			setError(parsed.error)
			return
		}
		setError(null)
		importRows.mutate(
			{ rows: parsed.rows },
			{
				onSuccess: result => {
					setSaved(
						`Imported ${result.imported} period${result.imported === 1 ? "" : "s"}` +
							`${result.replaced > 0 ? `, replacing ${result.replaced} already held` : ""}.`
					)
					setText("")
				},
				onError: () =>
					setError("The import was refused. Check the figures and try again."),
			}
		)
	}

	return (
		<form className="space-y-4 border-t pt-6" onSubmit={submit}>
			<h3 className="text-sm font-medium">Import a store report</h3>
			<p className="text-muted-foreground text-sm">
				CSV, with this header line: <code>{CSV_HEADER}</code>. Re-importing a period
				replaces it rather than adding to it.
			</p>
			<div className="min-w-0 space-y-2">
				<Label htmlFor="store-csv-file">CSV file</Label>
				<input
					id="store-csv-file"
					name="file"
					type="file"
					accept=".csv,text/csv"
					className="border-input min-h-11 w-full rounded-md border px-3 py-2 text-sm"
					onChange={onFile}
				/>
			</div>
			<div className="min-w-0 space-y-2">
				<Label htmlFor="store-csv-text">Or paste the rows</Label>
				<Textarea
					id="store-csv-text"
					name="csv"
					rows={4}
					value={text}
					onChange={event => setText(event.target.value)}
					placeholder={CSV_HEADER}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-4">
				<Button type="submit" className="min-h-11" disabled={importRows.isPending}>
					{importRows.isPending ? "Importing…" : "Import Report"}
				</Button>
				{error ? (
					<p id="store-import-error" role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				{saved ? (
					<p role="status" className="text-muted-foreground text-sm">
						{saved}
					</p>
				) : null}
			</div>
		</form>
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
