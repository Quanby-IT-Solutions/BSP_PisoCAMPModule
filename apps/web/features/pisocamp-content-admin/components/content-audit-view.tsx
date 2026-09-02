"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import {
	PISO_CAMP_CONTENT_AUDIT_ACTIONS,
	type PisoCampContentAuditAction,
	type PisoCampContentAuditEntry,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { usePisoCampContentAuditQuery } from "@/features/pisocamp-content-admin/api/audit.hooks"

const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
	timeZone: "Asia/Manila",
})

const ACTION_LABELS: Record<PisoCampContentAuditAction, string> = {
	"content.create": "Created",
	"content.edit": "Edited",
	"content.submit": "Submitted for review",
	"content.approve": "Approved",
	"content.reject": "Rejected",
	"content.publish": "Published",
	"content.unpublish": "Unpublished",
	"content.deactivate": "Deactivated",
	"content.archive": "Archived",
	"content.schedule": "Publication scheduled",
	"content.restore": "Version restored",
	"content.preview": "Previewed",
	"content.asset.upload": "Asset uploaded",
	"content.asset.attach": "Asset attached",
	"content.asset.detach": "Asset detached",
	"content.asset.delete": "Asset deleted",
}

function titleCase(value: string) {
	const label = value.split("_").join(" ")
	return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function AuditRow({ entry }: { entry: PisoCampContentAuditEntry }) {
	return (
		<li className="min-w-0 border-b py-4 last:border-b-0">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="outline">{ACTION_LABELS[entry.action]}</Badge>
				{entry.fromState && entry.toState ? (
					<span className="text-sm">
						{titleCase(entry.fromState)} → {titleCase(entry.toState)}
					</span>
				) : null}
				{entry.versionNo !== null ? (
					<span className="text-muted-foreground text-sm">Version {entry.versionNo}</span>
				) : null}
			</div>
			<p className="mt-1 text-sm break-words">
				<span className="font-medium">{entry.actor ? entry.actor.name : "Removed account"}</span> —{" "}
				<time dateTime={entry.at}>
					{MANILA_DATE_FORMATTER.format(new Date(entry.at))} (Asia/Manila)
				</time>
			</p>
			{entry.comments ? (
				<p className="mt-1 text-sm break-words whitespace-pre-wrap">{entry.comments}</p>
			) : null}
		</li>
	)
}

/**
 * CM-7 per-item audit history.
 *
 * Read-only by construction — there is no control here that writes anything.
 * Filters live in component state and are sent to the server, so paging and
 * narrowing agree with each other on a trail that never stops growing.
 */
export function ContentAuditView({ itemId }: { itemId: string }) {
	const [page, setPage] = useState(1)
	const [actorId, setActorId] = useState("")
	const [action, setAction] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const loadErrorRef = useRef<HTMLDivElement>(null)

	const limit = 25
	const rangeValid = !from || !to || from <= to
	// Derived, not state: the message is a pure function of the two fields, and
	// storing it would need an effect to keep it honest.
	const rangeError = rangeValid ? null : "The date range must start before it ends."
	const query = usePisoCampContentAuditQuery(
		{
			itemId,
			page,
			limit,
			...(actorId ? { actorId } : {}),
			...(action ? { action: action as PisoCampContentAuditAction } : {}),
			...(from ? { from: new Date(from).toISOString() } : {}),
			...(to ? { to: new Date(to).toISOString() } : {}),
		},
		rangeValid
	)

	useEffect(() => {
		if (query.isError) loadErrorRef.current?.focus()
	}, [query.isError])

	function resetTo(update: () => void) {
		update()
		setPage(1)
	}

	if (query.isPending && rangeValid) {
		return (
			<div role="status" aria-label="Loading audit history…" className="space-y-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-96 w-full" />
				<span className="sr-only">Loading audit history…</span>
			</div>
		)
	}

	const data = query.data
	const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

	return (
		<div data-testid="content-audit-layout" className="w-full max-w-full min-w-0 space-y-6">
			<PageHeader
				title="Audit History"
				description="Every recorded change and approval for this content item, newest first."
				wrapTitle
			/>

			<Card className="min-w-0 overflow-visible">
				<CardHeader>
					<CardTitle as="h2">Filters</CardTitle>
				</CardHeader>
				<CardContent className="min-w-0">
					<div className="grid min-w-0 gap-4 sm:grid-cols-2">
						<div className="min-w-0 space-y-2">
							<Label htmlFor="audit-actor">Actor</Label>
							<select
								id="audit-actor"
								name="actorId"
								className="border-input bg-background min-h-11 w-full min-w-0 rounded-lg border px-3 text-sm"
								value={actorId}
								onChange={event => resetTo(() => setActorId(event.target.value))}
							>
								<option value="">Everyone</option>
								{(data?.actors ?? []).map(actor => (
									<option key={actor.id} value={actor.id}>
										{actor.name}
									</option>
								))}
							</select>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="audit-action">Action</Label>
							<select
								id="audit-action"
								name="action"
								className="border-input bg-background min-h-11 w-full min-w-0 rounded-lg border px-3 text-sm"
								value={action}
								onChange={event => resetTo(() => setAction(event.target.value))}
							>
								<option value="">Every action</option>
								{PISO_CAMP_CONTENT_AUDIT_ACTIONS.map(name => (
									<option key={name} value={name}>
										{ACTION_LABELS[name]}
									</option>
								))}
							</select>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="audit-from">From</Label>
							<Input
								id="audit-from"
								name="from"
								type="datetime-local"
								className="min-h-11 w-full min-w-0"
								value={from}
								aria-invalid={rangeError !== null}
								aria-describedby={rangeError ? "audit-range-error" : undefined}
								onChange={event => resetTo(() => setFrom(event.target.value))}
							/>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="audit-to">To</Label>
							<Input
								id="audit-to"
								name="to"
								type="datetime-local"
								className="min-h-11 w-full min-w-0"
								value={to}
								aria-invalid={rangeError !== null}
								aria-describedby={rangeError ? "audit-range-error" : undefined}
								onChange={event => resetTo(() => setTo(event.target.value))}
							/>
						</div>
					</div>
					{rangeError ? (
						<p id="audit-range-error" role="alert" className="text-destructive mt-3 text-sm">
							{rangeError}
						</p>
					) : null}
					<Button
						type="button"
						variant="outline"
						className="mt-4 min-h-11 touch-manipulation transition-colors"
						disabled={!actorId && !action && !from && !to}
						onClick={() =>
							resetTo(() => {
								setActorId("")
								setAction("")
								setFrom("")
								setTo("")
							})
						}
					>
						Clear Filters
					</Button>
				</CardContent>
			</Card>

			{query.isError ? (
				<Alert ref={loadErrorRef} tabIndex={-1} role="alert" variant="destructive">
					<AlertTitle>Could Not Load Audit History</AlertTitle>
					<AlertDescription>
						Check your connection and access, then try again.
						<Button
							type="button"
							variant="outline"
							className="mt-3 min-h-11 touch-manipulation transition-colors"
							onClick={() => query.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{data ? (
				<Card className="min-w-0 overflow-visible">
					<CardHeader>
						<CardTitle as="h2">
							{data.total === 0 ? "No Matching Entries" : `${data.total} Recorded Entries`}
						</CardTitle>
					</CardHeader>
					<CardContent className="min-w-0">
						{data.entries.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Nothing matches these filters. Clear them to see the whole history.
							</p>
						) : (
							<ol className="min-w-0">
								{data.entries.map(entry => (
									<AuditRow key={entry.id} entry={entry} />
								))}
							</ol>
						)}

						{totalPages > 1 ? (
							<nav aria-label="Audit history pages" className="mt-4 flex flex-wrap gap-3">
								<Button
									type="button"
									variant="outline"
									className="min-h-11 touch-manipulation transition-colors"
									disabled={page <= 1}
									onClick={() => setPage(current => Math.max(1, current - 1))}
								>
									Previous
								</Button>
								<p role="status" className="self-center text-sm">
									Page {page} of {totalPages}
								</p>
								<Button
									type="button"
									variant="outline"
									className="min-h-11 touch-manipulation transition-colors"
									disabled={page >= totalPages}
									onClick={() => setPage(current => Math.min(totalPages, current + 1))}
								>
									Next
								</Button>
							</nav>
						) : null}
					</CardContent>
				</Card>
			) : null}

			<Button
				variant="outline"
				className="min-h-11 touch-manipulation"
				render={<Link href={`/pisocamp/content/${itemId}/edit`} />}
			>
				Back To Content
			</Button>
		</div>
	)
}
