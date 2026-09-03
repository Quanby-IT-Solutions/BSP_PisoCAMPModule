"use client"

import { useState, type FormEvent } from "react"

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
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { Textarea } from "@/core/components/ui/textarea"
import {
	useRecordPerformanceTestMutation,
	useTechnicalMetricsQuery,
} from "@/features/analytics/api/analytics.hooks"
import {
	AnalyticsRangeCard,
	daysBefore,
	manilaToday,
} from "@/features/analytics/components/analytics-range-card"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

const FAILURE_LABELS: Record<string, string> = {
	timeout: "Timed out",
	no_connectivity: "No connectivity",
	sync_failed: "Sync failed",
	download_failed: "Download failed",
	report_failed: "Report failed",
	upload_failed: "Upload failed",
}

function milliseconds(value: number | null) {
	return value === null ? "No loads yet" : `${number.format(value)} ms`
}

export function TechnicalDashboard({ canRecord }: { canRecord: boolean }) {
	const today = manilaToday()
	const [range, setRange] = useState({ from: daysBefore(today, 29), to: today })
	const summary = useTechnicalMetricsQuery(range)

	return (
		<div className="space-y-6">
			<PageHeader
				title="Technical health"
				description="Crashes, load times, API health and network failures, by Asia/Manila day."
			/>

			<AnalyticsRangeCard idPrefix="technical" initial={range} onApply={setRange} />

			{summary.isPending ? (
				<div role="status" aria-label="Loading technical health" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading technical health</span>
				</div>
			) : summary.isError || !summary.data ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load technical health</AlertTitle>
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
							<CardTitle>Crashes</CardTitle>
							<CardDescription>
								Imported from the monitoring tool: a process that has died cannot
								report its own death.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{summary.data.crashes === null ? (
								<p className="text-muted-foreground text-sm">
									Nothing has been imported for this range. That is not the same as
									nothing having crashed.
								</p>
							) : (
								<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
									<Figure
										label="Crash-free sessions"
										value={`${decimal.format(
											summary.data.crashes.crashFreeSessionRatePercent
										)}%`}
										hint={`${number.format(
											summary.data.crashes.affectedSessions
										)} of ${number.format(
											summary.data.crashes.totalSessions
										)} sessions crashed`}
									/>
									<Figure
										label="Crashes"
										value={number.format(summary.data.crashes.crashCount)}
										hint={`From ${summary.data.crashes.source}`}
									/>
									<Figure
										label="Users affected"
										value={number.format(summary.data.crashes.affectedUsers)}
										hint="People who met at least one crash"
									/>
									<Figure
										label="Crashes per session"
										value={decimal.format(summary.data.crashes.crashesPerSession)}
										hint="Across the imported periods"
									/>
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Load time</CardTitle>
							<CardDescription>
								Measured on the device to the first frame: what somebody waits for is
								something to look at.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<Figure
								label="Median (p50)"
								value={milliseconds(summary.data.loadTime.p50Ms)}
								hint={`${number.format(summary.data.loadTime.samples)} loads`}
							/>
							<Figure
								label="p95"
								value={milliseconds(summary.data.loadTime.p95Ms)}
								hint="The slow tail people remember"
							/>
							<Figure
								label="Slowest"
								value={milliseconds(summary.data.loadTime.maxMs)}
								hint="The worst single load"
							/>
							<Figure
								label="Cold starts"
								value={number.format(summary.data.loadTime.coldSamples)}
								hint={`${number.format(summary.data.loadTime.warmSamples)} warm`}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>API endpoints</CardTitle>
							<CardDescription>
								Latency is the worst period in the range: percentiles do not add, so
								an average of them would be a number nobody ever saw.
							</CardDescription>
						</CardHeader>
						<CardContent className="min-w-0 overflow-x-auto">
							{summary.data.endpoints.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No API figures have been imported for this range.
								</p>
							) : (
								<table className="w-full min-w-0 text-sm">
									<caption className="sr-only">API health for each endpoint</caption>
									<thead>
										<tr className="text-left">
											<th scope="col" className="py-2 pr-4">
												Endpoint
											</th>
											<th scope="col" className="py-2 pr-4">
												Requests
											</th>
											<th scope="col" className="py-2 pr-4">
												Errors
											</th>
											<th scope="col" className="py-2 pr-4">
												Timeouts
											</th>
											<th scope="col" className="py-2 pr-4">
												Auth failures
											</th>
											<th scope="col" className="py-2">
												Latency p50 / p95
											</th>
										</tr>
									</thead>
									<tbody>
										{summary.data.endpoints.map(endpoint => (
											<tr key={endpoint.endpoint} className="border-t">
												<td className="py-2 pr-4">{endpoint.endpoint}</td>
												<td className="py-2 pr-4">
													{number.format(endpoint.requestCount)}
												</td>
												<td className="py-2 pr-4">
													{number.format(endpoint.errorCount)} (
													{decimal.format(endpoint.errorRatePercent)}%)
												</td>
												<td className="py-2 pr-4">
													{number.format(endpoint.timeoutCount)}
												</td>
												<td className="py-2 pr-4">
													{number.format(endpoint.authFailureCount)}
												</td>
												<td className="py-2">
													{number.format(endpoint.latencyP50Ms)} /{" "}
													{number.format(endpoint.latencyP95Ms)} ms
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Network failures</CardTitle>
							<CardDescription>
								{number.format(summary.data.networkFailureTotal)} in this range. A
								missing network and a slow one are different problems.
							</CardDescription>
						</CardHeader>
						<CardContent className="min-w-0 overflow-x-auto">
							<table className="w-full min-w-0 text-sm">
								<caption className="sr-only">Network failures by kind</caption>
								<thead>
									<tr className="text-left">
										<th scope="col" className="py-2 pr-4">
											Kind
										</th>
										<th scope="col" className="py-2">
											Count
										</th>
									</tr>
								</thead>
								<tbody>
									{summary.data.networkFailures.map(failure => (
										<tr key={failure.failureType} className="border-t">
											<td className="py-2 pr-4">
												{FAILURE_LABELS[failure.failureType] ?? failure.failureType}
											</td>
											<td className="py-2">{number.format(failure.count)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Performance test results</CardTitle>
							<CardDescription>
								Measured on real hardware and entered by hand, so each entry names
								who stands behind it.
							</CardDescription>
						</CardHeader>
						<CardContent className="min-w-0 space-y-6 overflow-x-auto">
							{summary.data.performanceTests.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No performance test was recorded in this range.
								</p>
							) : (
								<table className="w-full min-w-0 text-sm">
									<caption className="sr-only">Recorded performance test runs</caption>
									<thead>
										<tr className="text-left">
											<th scope="col" className="py-2 pr-4">
												Tested
											</th>
											<th scope="col" className="py-2 pr-4">
												Build
											</th>
											<th scope="col" className="py-2 pr-4">
												App size
											</th>
											<th scope="col" className="py-2 pr-4">
												Module increase
											</th>
											<th scope="col" className="py-2 pr-4">
												Assets
											</th>
											<th scope="col" className="py-2 pr-4">
												Local storage
											</th>
											<th scope="col" className="py-2">
												Battery
											</th>
										</tr>
									</thead>
									<tbody>
										{summary.data.performanceTests.map(test => (
											<tr key={test.id} className="border-t">
												<td className="py-2 pr-4">{test.testedAt}</td>
												<td className="py-2 pr-4">
													{test.appVersion} · {test.platform} · {test.deviceModel}
												</td>
												<td className="py-2 pr-4">
													{decimal.format(test.appSizeMb)} MB
												</td>
												<td className="py-2 pr-4">
													{decimal.format(test.moduleSizeIncreaseMb)} MB
												</td>
												<td className="py-2 pr-4">
													{decimal.format(test.downloadedAssetsMb)} MB
												</td>
												<td className="py-2 pr-4">
													{decimal.format(test.localStorageMb)} MB
												</td>
												<td className="py-2">
													{decimal.format(test.batteryImpactPercent)}%
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}

							{canRecord ? <PerformanceTestForm /> : null}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}

/** AN-025's manual entry. Only offered to somebody who may actually save it. */
function PerformanceTestForm() {
	const record = useRecordPerformanceTestMutation()
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState<string | null>(null)

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = event.currentTarget
		const data = new FormData(form)
		const numeric = (name: string) => Number(data.get(name))
		const notes = String(data.get("notes") ?? "").trim()

		if (numeric("appSizeMb") <= 0) {
			setError("The app has a size, so it cannot be zero.")
			return
		}
		if (numeric("batteryImpactPercent") > 100) {
			setError("Battery impact is a share of a full charge, so it cannot pass 100%.")
			return
		}

		setError(null)
		record.mutate(
			{
				testedAt: String(data.get("testedAt")),
				appVersion: String(data.get("appVersion")).trim(),
				platform: String(data.get("platform")) as "android" | "ios",
				deviceModel: String(data.get("deviceModel")).trim(),
				appSizeMb: numeric("appSizeMb"),
				moduleSizeIncreaseMb: numeric("moduleSizeIncreaseMb"),
				downloadedAssetsMb: numeric("downloadedAssetsMb"),
				localStorageMb: numeric("localStorageMb"),
				batteryImpactPercent: numeric("batteryImpactPercent"),
				notes: notes.length === 0 ? null : notes,
			},
			{
				onSuccess: result => {
					setSaved(`Recorded the run tested on ${result.testedAt}.`)
					form.reset()
				},
				onError: () => setError("Could not record the run. Check the figures and try again."),
			}
		)
	}

	return (
		<form className="space-y-4 border-t pt-6" onSubmit={submit}>
			<h3 className="text-sm font-medium">Record a performance test</h3>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Field id="perf-tested-at" name="testedAt" label="Tested on" type="date" required />
				<Field
					id="perf-app-version"
					name="appVersion"
					label="App version"
					placeholder="1.2.0+8"
					required
				/>
				<div className="min-w-0 space-y-2">
					<Label htmlFor="perf-platform">Platform</Label>
					<select
						id="perf-platform"
						name="platform"
						className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-sm"
						defaultValue="android"
					>
						<option value="android">Android</option>
						<option value="ios">iOS</option>
					</select>
				</div>
				<Field
					id="perf-device"
					name="deviceModel"
					label="Device"
					placeholder="Pixel 7a"
					required
				/>
				<Field
					id="perf-app-size"
					name="appSizeMb"
					label="App size (MB)"
					type="number"
					step="0.01"
					required
				/>
				<Field
					id="perf-module-size"
					name="moduleSizeIncreaseMb"
					label="Module increase (MB)"
					type="number"
					step="0.01"
					required
				/>
				<Field
					id="perf-assets"
					name="downloadedAssetsMb"
					label="Downloaded assets (MB)"
					type="number"
					step="0.01"
					required
				/>
				<Field
					id="perf-storage"
					name="localStorageMb"
					label="Local storage (MB)"
					type="number"
					step="0.01"
					required
				/>
				<Field
					id="perf-battery"
					name="batteryImpactPercent"
					label="Battery impact (%)"
					type="number"
					step="0.1"
					required
				/>
			</div>
			<div className="min-w-0 space-y-2">
				<Label htmlFor="perf-notes">Notes</Label>
				<Textarea
					id="perf-notes"
					name="notes"
					rows={2}
					placeholder="How the run was conducted."
				/>
			</div>
			<div className="flex flex-wrap items-center gap-4">
				<Button type="submit" className="min-h-11" disabled={record.isPending}>
					{record.isPending ? "Recording…" : "Record Run"}
				</Button>
				{error ? (
					<p id="perf-error" role="alert" className="text-destructive text-sm">
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

function Field({
	id,
	name,
	label,
	type = "text",
	step,
	placeholder,
	required,
}: {
	id: string
	name: string
	label: string
	type?: string
	step?: string
	placeholder?: string
	required?: boolean
}) {
	return (
		<div className="min-w-0 space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				name={name}
				type={type}
				step={step}
				placeholder={placeholder}
				required={required}
				className="min-h-11"
			/>
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
