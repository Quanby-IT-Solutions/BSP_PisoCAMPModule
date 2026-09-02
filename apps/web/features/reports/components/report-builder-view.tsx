"use client"

import { useMemo, useState, type FormEvent } from "react"

import type { ReportDefinition, ReportFilters, ReportRun } from "@repo/contracts"

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
import {
	useGenerateReportMutation,
	useReportDefinitionsQuery,
	useReportRunsQuery,
} from "@/features/reports/api/reports.hooks"

/**
 * How each filter is asked for.
 *
 * A filter is a line here, matching the registry it mirrors: the screen offers
 * whatever a definition says it supports, and nothing it does not.
 */
const FILTER_FIELDS: {
	key: keyof ReportFilters
	label: string
	placeholder: string
}[] = [
	{ key: "appVersion", label: "App version", placeholder: "1.0.0" },
	{ key: "feature", label: "Feature", placeholder: "currency_education" },
	{ key: "userType", label: "User type", placeholder: "guest or registered" },
	{ key: "device", label: "Device", placeholder: "phone or tablet" },
	{ key: "os", label: "OS", placeholder: "android or ios" },
	{ key: "activityType", label: "Activity type", placeholder: "module_entry" },
]

function manilaToday() {
	return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
}

function daysBefore(date: string, days: number) {
	return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000)
		.toISOString()
		.slice(0, 10)
}

export function ReportBuilderView() {
	const definitions = useReportDefinitionsQuery()
	const runs = useReportRunsQuery()
	const generate = useGenerateReportMutation()

	const today = manilaToday()
	const [definitionKey, setDefinitionKey] = useState<string>("")
	const [range, setRange] = useState({ from: daysBefore(today, 29), to: today })
	const [filters, setFilters] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)

	const selected: ReportDefinition | undefined = useMemo(() => {
		const list = definitions.data?.definitions ?? []
		return list.find(definition => definition.key === definitionKey) ?? list[0]
	}, [definitions.data, definitionKey])

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!selected) return
		if (range.from > range.to) {
			setError("The range must start on or before it ends.")
			return
		}
		setError(null)

		const applied = Object.fromEntries(
			(selected.filters as string[])
				.map(key => [key, filters[key]?.trim()])
				.filter(([, value]) => Boolean(value))
		) as ReportFilters

		generate.mutate({
			id: crypto.randomUUID(),
			definitionKey: selected.key,
			from: range.from,
			to: range.to,
			filters: applied,
		})
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Reports"
				description="Run a KPI report for a past period, with filters."
			/>

			{definitions.isPending ? (
				<div role="status" aria-label="Loading reports" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading reports</span>
				</div>
			) : definitions.isError || !definitions.data ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load the report list</AlertTitle>
					<AlertDescription>
						Check your connection or access, then try again.
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => definitions.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Parameters</CardTitle>
						<CardDescription>
							{selected
								? `${selected.description} Source: ${selected.dataSource}.`
								: "Choose a report."}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="space-y-5" onSubmit={submit} noValidate>
							<div className="space-y-2">
								<Label htmlFor="report-definition">Report</Label>
								<select
									id="report-definition"
									name="definitionKey"
									className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-sm"
									value={selected?.key ?? ""}
									onChange={event => setDefinitionKey(event.target.value)}
								>
									{definitions.data.definitions.map(definition => (
										<option key={definition.key} value={definition.key}>
											{definition.name}
										</option>
									))}
								</select>
							</div>

							<div className="flex flex-wrap gap-4">
								<div className="min-w-0 space-y-2">
									<Label htmlFor="report-from">From</Label>
									<Input
										id="report-from"
										name="from"
										type="date"
										className="min-h-11"
										value={range.from}
										onChange={event => setRange({ ...range, from: event.target.value })}
										aria-invalid={error ? true : undefined}
										aria-describedby={error ? "report-range-error" : undefined}
									/>
								</div>
								<div className="min-w-0 space-y-2">
									<Label htmlFor="report-to">To</Label>
									<Input
										id="report-to"
										name="to"
										type="date"
										className="min-h-11"
										value={range.to}
										onChange={event => setRange({ ...range, to: event.target.value })}
									/>
								</div>
							</div>

							{selected && selected.filters.length > 0 ? (
								<fieldset className="space-y-4">
									<legend className="text-sm font-medium">Filters</legend>
									<div className="grid gap-4 sm:grid-cols-2">
										{FILTER_FIELDS.filter(field =>
											(selected.filters as string[]).includes(field.key)
										).map(field => (
											<div key={field.key} className="min-w-0 space-y-2">
												<Label htmlFor={`report-filter-${field.key}`}>{field.label}</Label>
												<Input
													id={`report-filter-${field.key}`}
													name={field.key}
													className="min-h-11"
													autoComplete="off"
													placeholder={field.placeholder}
													value={filters[field.key] ?? ""}
													onChange={event =>
														setFilters({ ...filters, [field.key]: event.target.value })
													}
												/>
											</div>
										))}
									</div>
								</fieldset>
							) : (
								<p className="text-muted-foreground text-sm">
									This report takes a period only.
								</p>
							)}

							{error ? (
								<p id="report-range-error" role="alert" className="text-destructive text-sm">
									{error}
								</p>
							) : null}
							{generate.isError ? (
								<Alert variant="destructive">
									<AlertTitle>Could not generate the report</AlertTitle>
									<AlertDescription>{generate.error.message}</AlertDescription>
								</Alert>
							) : null}

							<Button type="submit" className="min-h-11" disabled={generate.isPending}>
								{generate.isPending ? "Generating…" : "Generate Report"}
							</Button>
						</form>
					</CardContent>
				</Card>
			)}

			{generate.data ? <GeneratedReport run={generate.data} /> : null}

			<Card>
				<CardHeader>
					<CardTitle>Recent reports</CardTitle>
					<CardDescription>
						What was generated, by whom, and over which period.
					</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					{runs.isPending ? (
						<div role="status" aria-label="Loading report history">
							<Skeleton className="h-16 w-full" />
							<span className="sr-only">Loading report history</span>
						</div>
					) : runs.data && runs.data.runs.length > 0 ? (
						<table className="w-full min-w-0 text-sm">
							<caption className="sr-only">Recently generated reports</caption>
							<thead>
								<tr className="text-left">
									<th scope="col" className="py-2 pr-4">
										Report
									</th>
									<th scope="col" className="py-2 pr-4">
										Period
									</th>
									<th scope="col" className="py-2 pr-4">
										Generated
									</th>
									<th scope="col" className="py-2">
										Status
									</th>
								</tr>
							</thead>
							<tbody>
								{runs.data.runs.map(run => (
									<tr key={run.id} className="border-t">
										<td className="py-2 pr-4">{run.definitionName}</td>
										<td className="py-2 pr-4">
											{run.from} to {run.to}
										</td>
										<td className="py-2 pr-4">{run.generatedAt.slice(0, 10)}</td>
										<td className="py-2">{run.suppressed ? "Withheld" : "Complete"}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<p className="text-muted-foreground text-sm">No report has been run yet.</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

function GeneratedReport({ run }: { run: ReportRun }) {
	const applied = Object.entries(run.filters).filter(([, value]) => value !== undefined)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{run.definitionName}</CardTitle>
				<CardDescription>
					Generated {run.generatedAt} from {run.dataSource}, covering {run.from} to {run.to}{" "}
					({run.timezone}).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm">
					<strong>Filters:</strong>{" "}
					{applied.length === 0
						? "none"
						: applied.map(([key, value]) => `${key} = ${String(value)}`).join(", ")}
				</p>

				{run.suppressed ? (
					<Alert>
						<AlertTitle>Figures withheld</AlertTitle>
						<AlertDescription>{run.suppressionReason}</AlertDescription>
					</Alert>
				) : (
					<pre className="bg-muted min-w-0 overflow-x-auto rounded-md p-3 text-xs">
						{JSON.stringify(run.result, null, 2)}
					</pre>
				)}
			</CardContent>
		</Card>
	)
}
