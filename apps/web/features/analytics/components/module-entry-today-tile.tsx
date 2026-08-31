"use client"

import { useId } from "react"

import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { useModuleEntryTodayQuery } from "@/features/analytics/api/analytics.hooks"

const countFormatter = new Intl.NumberFormat("en-US")
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
	dateStyle: "medium",
	timeZone: "Asia/Manila",
})

function formatManilaDate(date: string) {
	return dateFormatter.format(new Date(`${date}T00:00:00+08:00`))
}

export function ModuleEntryTodayTile() {
	const headingId = useId()
	const summary = useModuleEntryTodayQuery({ enabled: true })
	const isLoading = useIsQueryLoading()(summary)
	const isOfflineWithoutData =
		summary.data === undefined && summary.status === "pending" && summary.fetchStatus === "paused"

	return (
		<Card role="region" aria-labelledby={headingId} className="w-full min-w-0">
			<CardHeader>
				<CardTitle as="h2" id={headingId} className="text-pretty break-words">
					Module entries today
				</CardTitle>
			</CardHeader>
			<CardContent className="min-w-0">
				{isLoading ? (
					<div role="status" aria-live="polite" aria-atomic="true" className="min-h-14">
						<span className="sr-only">Loading module entries today…</span>
						<Skeleton aria-hidden="true" className="mb-2 h-8 w-20" />
						<Skeleton aria-hidden="true" className="h-4 w-36 max-w-full" />
					</div>
				) : isOfflineWithoutData ? (
					<p
						role="status"
						aria-live="polite"
						aria-atomic="true"
						className="text-muted-foreground min-h-14 text-sm text-pretty"
					>
						Module entries are unavailable while offline. Reconnect to try again.
					</p>
				) : summary.isError ? (
					<div role="alert" className="flex min-h-14 flex-wrap items-center gap-2">
						<p className="text-destructive min-w-0 flex-1 text-sm">
							Could not load module entries. Please try again.
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-label="Retry module entries"
							onClick={() => void summary.refetch()}
						>
							Retry
						</Button>
					</div>
				) : (
					<div className="min-w-0">
						<p
							aria-live="polite"
							aria-atomic="true"
							aria-label={`${countFormatter.format(summary.data?.moduleEntryCount ?? 0)} module entries today`}
							className="text-foreground text-2xl font-bold tabular-nums"
						>
							{countFormatter.format(summary.data?.moduleEntryCount ?? 0)}
						</p>
						<time
							dateTime={summary.data?.date}
							className="text-muted-foreground mt-1 block text-xs break-words"
						>
							{summary.data ? formatManilaDate(summary.data.date) : ""} · Asia/Manila
						</time>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
