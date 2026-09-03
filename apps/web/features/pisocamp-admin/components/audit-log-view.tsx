"use client"

import { useState, type FormEvent } from "react"

import type { AuditLogEntry } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Badge } from "@/core/components/ui/badge"
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
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { usePisoCampAuditQuery } from "@/features/pisocamp-admin/api/audit.hooks"
import {
	reportExportUrl,
	useGenerateReportMutation,
} from "@/features/reports/api/reports.hooks"

const PAGE_SIZE = 50

const FILTERS = [
	{ key: "actorId", id: "audit-actor", label: "Actor", placeholder: "The account id" },
	{ key: "action", id: "audit-action", label: "Action", placeholder: "report.generate" },
	{ key: "targetType", id: "audit-target-type", label: "Target type", placeholder: "user" },
	{ key: "from", id: "audit-from", label: "From", type: "date" },
	{ key: "to", id: "audit-to", label: "To", type: "date" },
] as const

type FilterKey = (typeof FILTERS)[number]["key"]

const EXPORT_FORMATS = [
	{ format: "xlsx" as const, label: "Excel" },
	{ format: "docx" as const, label: "Word" },
	{ format: "pdf" as const, label: "PDF" },
]

/** Shown as it is stored, so the trail reads the same here as in the file. */
function display(value: unknown): string {
	if (value === null || value === undefined) return "—"
	return typeof value === "string" ? value : JSON.stringify(value)
}

export function AuditLogView() {
	const [applied, setApplied] = useState<Record<FilterKey, string>>({
		actorId: "",
		action: "",
		targetType: "",
		from: "",
		to: "",
	})
	const [draft, setDraft] = useState(applied)
	const [cursors, setCursors] = useState<number[]>([])

	const before = cursors.at(-1)
	const entries = usePisoCampAuditQuery({
		limit: PAGE_SIZE,
		...(before ? { before } : {}),
		// An empty box is not a filter for the empty string.
		...Object.fromEntries(
			Object.entries(applied).filter(([, value]) => value.trim() !== "")
		),
	})

	function apply(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setCursors([])
		setApplied(draft)
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Audit Log"
				description="Who did what, when, and what it was before."
			/>

			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>
						Leave a box empty to include everything. Dates are Asia/Manila days,
						inclusive.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="flex flex-wrap items-end gap-4" onSubmit={apply}>
						{FILTERS.map(filter => (
							<div key={filter.key} className="min-w-0 space-y-2">
								<Label htmlFor={filter.id}>{filter.label}</Label>
								<Input
									id={filter.id}
									name={filter.key}
									className="min-h-11"
									autoComplete="off"
									type={"type" in filter ? filter.type : "text"}
									placeholder={"placeholder" in filter ? filter.placeholder : undefined}
									value={draft[filter.key]}
									onChange={event =>
										setDraft({ ...draft, [filter.key]: event.target.value })
									}
								/>
							</div>
						))}
						<Button type="submit" className="min-h-11">
							Apply Filters
						</Button>
					</form>
				</CardContent>
			</Card>

			<AuditExport filters={applied} />

			<Card>
				<CardHeader>
					<CardTitle>Entries</CardTitle>
					<CardDescription>Newest first, including refusals.</CardDescription>
				</CardHeader>
				<CardContent className="min-w-0 overflow-x-auto">
					{entries.isPending ? (
						<div role="status" aria-label="Loading audit entries" className="space-y-3">
							<Skeleton className="h-32 w-full" />
							<span className="sr-only">Loading audit entries</span>
						</div>
					) : entries.isError || !entries.data ? (
						<Alert variant="destructive">
							<AlertTitle>Could not load the audit log</AlertTitle>
							<AlertDescription>
								Check your connection or access, then try again.
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="mt-3"
									onClick={() => entries.refetch()}
								>
									Try Again
								</Button>
							</AlertDescription>
						</Alert>
					) : entries.data.entries.length === 0 ? (
						<p className="text-muted-foreground text-sm">No entry matches those filters.</p>
					) : (
						<Table>
							<TableCaption className="sr-only">
								Administrative audit entries, newest first
							</TableCaption>
							<TableHeader>
								<TableRow>
									<TableHead>When</TableHead>
									<TableHead>Actor</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>Target</TableHead>
									<TableHead>Before</TableHead>
									<TableHead>After</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{entries.data.entries.map((entry: AuditLogEntry) => (
									<TableRow key={entry.id}>
										<TableCell>{new Date(entry.createdAt).toISOString()}</TableCell>
										<TableCell>{entry.actorEmail ?? entry.actorId ?? "system"}</TableCell>
										<TableCell>
											<span className="flex flex-wrap items-center gap-2">
												{entry.action}
												{entry.outcome === "denied" ? (
													<Badge variant="destructive">Denied</Badge>
												) : null}
											</span>
										</TableCell>
										<TableCell>
											{[entry.targetType, entry.targetId].filter(Boolean).join(" ") || "—"}
										</TableCell>
										<TableCell>{display(entry.oldValue)}</TableCell>
										<TableCell>{display(entry.newValue)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<nav className="flex items-center gap-4" aria-label="Audit log pages">
				<Button
					type="button"
					variant="outline"
					className="min-h-11"
					disabled={cursors.length === 0}
					onClick={() => setCursors(cursors.slice(0, -1))}
				>
					Newer
				</Button>
				<Button
					type="button"
					variant="outline"
					className="min-h-11"
					disabled={!entries.data?.nextCursor}
					onClick={() =>
						entries.data?.nextCursor
							? setCursors([...cursors, entries.data.nextCursor])
							: undefined
					}
				>
					Older
				</Button>
			</nav>
		</div>
	)
}

/**
 * Exporting the trail goes through AN-9.
 *
 * The audit log is a report definition, so the file is rendered by the same
 * three renderers as every other report and the export is recorded by AN-9's
 * own entry — which lands in this very trail.
 */
function AuditExport({ filters }: { filters: Record<FilterKey, string> }) {
	const generate = useGenerateReportMutation()

	function prepare() {
		// Read at the moment the button is pressed, not when this rendered: the
		// range somebody means by "today" is the day they asked, and reading the
		// clock during render is not something a component may do.
		const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)

		generate.mutate({
			id: crypto.randomUUID(),
			definitionKey: "audit",
			from: filters.from || today,
			to: filters.to || today,
			filters: {
				...(filters.actorId ? { actor: filters.actorId } : {}),
				...(filters.action ? { activityType: filters.action } : {}),
				...(filters.targetType ? { targetType: filters.targetType } : {}),
			},
		})
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Export</CardTitle>
				<CardDescription>
					Produces a report of these filters, which is itself recorded here.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Button
					type="button"
					className="min-h-11"
					disabled={generate.isPending}
					onClick={prepare}
				>
					{generate.isPending ? "Preparing…" : "Prepare Export"}
				</Button>

				{generate.isError ? (
					<Alert variant="destructive">
						<AlertTitle>Could not prepare the export</AlertTitle>
						<AlertDescription>{generate.error.message}</AlertDescription>
					</Alert>
				) : null}

				{generate.data ? (
					<p className="flex flex-wrap items-center gap-3 text-sm">
						<span>
							{generate.data.from} to {generate.data.to}:
						</span>
						{EXPORT_FORMATS.map(({ format, label }) => (
							<a
								key={format}
								href={reportExportUrl(generate.data!.id, format)}
								className="text-primary inline-flex min-h-11 items-center underline underline-offset-4"
								aria-label={`Export the audit log for ${generate.data!.from} to ${generate.data!.to} as ${label}`}
							>
								{label}
							</a>
						))}
					</p>
				) : null}
			</CardContent>
		</Card>
	)
}
