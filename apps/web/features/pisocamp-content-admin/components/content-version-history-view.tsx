"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
	RestorePisoCampContentVersionInputSchema,
	type PisoCampContentVersionHistoryEntry,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/core/components/ui/alert-dialog"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { Textarea } from "@/core/components/ui/textarea"
import {
	usePisoCampContentVersionsQuery,
	useRestorePisoCampContentVersionMutation,
} from "@/features/pisocamp-content-admin/api/versions.hooks"

const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZone: "Asia/Manila",
})

const FIELD_LABELS: Record<
	PisoCampContentVersionHistoryEntry["differences"][number]["field"],
	string
> = {
	title: "Title",
	summary: "Summary",
	body: "Body",
	seriesCode: "Currency series",
	denominationCode: "Denomination",
	primaryUrl: "Link address",
	relatedLinks: "Related links",
	assets: "Attachments",
}

function titleCase(value: string) {
	const label = value.split("_").join(" ")
	return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function ManilaTime({ value }: { value: string }) {
	return (
		<time dateTime={value}>
			{MANILA_DATE_FORMATTER.format(new Date(value))} <span>(Asia/Manila)</span>
		</time>
	)
}

function isConflict(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		(("status" in error && error.status === 409) || ("code" in error && error.code === "CONFLICT"))
	)
}

function VersionDifferences({ entry }: { entry: PisoCampContentVersionHistoryEntry }) {
	if (entry.isCurrentWorking) {
		return <p className="text-muted-foreground text-sm">This is the current version.</p>
	}
	if (!entry.differences.length) {
		return (
			<p className="text-muted-foreground text-sm">
				Identical to the current version in every compared field.
			</p>
		)
	}
	return (
		<dl className="min-w-0 space-y-3">
			{entry.differences.map(difference => (
				<div key={difference.field} className="min-w-0 space-y-1">
					<dt className="text-sm font-medium">{FIELD_LABELS[difference.field]}</dt>
					<dd className="min-w-0 space-y-1 text-sm">
						<p className="text-muted-foreground break-words whitespace-pre-wrap">
							<span className="font-medium">This version: </span>
							{difference.previous ?? "Not set"}
						</p>
						<p className="break-words whitespace-pre-wrap">
							<span className="font-medium">Current version: </span>
							{difference.current ?? "Not set"}
						</p>
					</dd>
				</div>
			))}
		</dl>
	)
}

export function ContentVersionHistoryView({
	canRestore,
	itemId,
}: {
	canRestore: boolean
	itemId: string
}) {
	const history = usePisoCampContentVersionsQuery({ itemId, page: 1, limit: 20 })
	const restore = useRestorePisoCampContentVersionMutation()
	const [openVersionNo, setOpenVersionNo] = useState<number | null>(null)
	const [comments, setComments] = useState("")
	const [commentsError, setCommentsError] = useState<string | null>(null)
	const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(
		null
	)
	const feedbackRef = useRef<HTMLDivElement>(null)
	const loadErrorRef = useRef<HTMLDivElement>(null)
	const commentsRef = useRef<HTMLTextAreaElement>(null)
	const inFlight = useRef(false)
	const requestIds = useRef<Record<number, string>>({})

	useEffect(() => {
		if (history.isError) loadErrorRef.current?.focus()
	}, [history.isError])

	useEffect(() => {
		if (!feedback) return
		const frame = requestAnimationFrame(() => feedbackRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [feedback])

	if (history.isPending) {
		return (
			<div role="status" aria-label="Loading version history…" className="space-y-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-96 w-full" />
				<span className="sr-only">Loading version history…</span>
			</div>
		)
	}

	if (history.isError || !history.data) {
		return (
			<Alert ref={loadErrorRef} tabIndex={-1} role="alert" variant="destructive">
				<AlertTitle>Could Not Load Version History</AlertTitle>
				<AlertDescription>
					Check your connection and access, then try again.
					<Button
						type="button"
						variant="outline"
						className="mt-3 min-h-11 touch-manipulation transition-colors"
						onClick={() => history.refetch()}
					>
						Try Again
					</Button>
				</AlertDescription>
			</Alert>
		)
	}

	const data = history.data

	function requestIdFor(versionNo: number) {
		requestIds.current[versionNo] ??= crypto.randomUUID()
		return requestIds.current[versionNo]!
	}

	function runRestore(versionNo: number) {
		if (inFlight.current) return
		const normalized = comments.trim()
		if (!RestorePisoCampContentVersionInputSchema.shape.comments.safeParse(normalized).success) {
			setCommentsError("A reason is required, in plain text without HTML.")
			commentsRef.current?.focus()
			return
		}

		inFlight.current = true
		setFeedback(null)
		restore.mutate(
			{
				itemId,
				versionNo,
				requestId: requestIdFor(versionNo),
				expectedVersionNo: data.currentVersionNo,
				comments: normalized,
			},
			{
				onSuccess: () => {
					inFlight.current = false
					requestIds.current[versionNo] = undefined as unknown as string
					setOpenVersionNo(null)
					setComments("")
					setCommentsError(null)
					setFeedback({
						tone: "success",
						message: `Version ${versionNo} restored as a new approved version. Publish it to make it live.`,
					})
					toast.success("Version restored.")
				},
				onError: error => {
					inFlight.current = false
					setOpenVersionNo(null)
					setFeedback({
						tone: "error",
						message: isConflict(error)
							? "This content changed while you were reading. Reload the history and try again."
							: "Could not restore this version. Check your connection and try again.",
					})
				},
			}
		)
	}

	return (
		<div
			data-testid="content-version-history-layout"
			className="w-full max-w-full min-w-0 space-y-6"
		>
			<PageHeader
				title="Version History"
				description={`Every immutable version of this item, newest first. Current version ${data.currentVersionNo}.`}
				wrapTitle
			/>

			{feedback ? (
				<Alert
					ref={feedbackRef}
					tabIndex={-1}
					role={feedback.tone === "error" ? "alert" : "status"}
					aria-live={feedback.tone === "error" ? "assertive" : "polite"}
					variant={feedback.tone === "error" ? "destructive" : "default"}
				>
					<AlertTitle>
						{feedback.tone === "error" ? "Restore Not Completed" : "Version Restored"}
					</AlertTitle>
					<AlertDescription>{feedback.message}</AlertDescription>
				</Alert>
			) : null}

			{!data.restoreAvailable ? (
				<Alert role="status">
					<AlertTitle>Restore Unavailable</AlertTitle>
					<AlertDescription>
						This item is {titleCase(data.itemStatus).toLowerCase()}. Restore is available once no
						review decision is pending and the item is not archived.
					</AlertDescription>
				</Alert>
			) : null}

			<ol className="min-w-0 space-y-4">
				{data.versions.map(entry => (
					<li key={entry.id} className="min-w-0">
						<Card className="min-w-0 overflow-visible">
							<CardHeader className="min-w-0">
								<CardTitle as="h2">Version {entry.versionNo}</CardTitle>
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="outline">{titleCase(entry.status)}</Badge>
									{entry.isCurrentWorking ? <Badge variant="secondary">Current</Badge> : null}
									{entry.isCurrentPublished ? <Badge variant="secondary">Live</Badge> : null}
									{entry.restoredFromVersionNo !== null ? (
										<Badge variant="outline">
											Restored from version {entry.restoredFromVersionNo}
										</Badge>
									) : null}
								</div>
							</CardHeader>
							<CardContent className="min-w-0 space-y-4">
								<dl className="grid min-w-0 gap-2 sm:grid-cols-2">
									<div className="min-w-0">
										<dt className="text-muted-foreground text-sm">Created by</dt>
										<dd className="break-words">
											{entry.createdBy.name} — <ManilaTime value={entry.createdAt} />
										</dd>
									</div>
									<div className="min-w-0">
										<dt className="text-muted-foreground text-sm">Approved by</dt>
										<dd className="break-words">
											{entry.approver && entry.approvedAt ? (
												<>
													{entry.approver.name} — <ManilaTime value={entry.approvedAt} />
												</>
											) : (
												"Not approved"
											)}
										</dd>
									</div>
									<div className="min-w-0">
										<dt className="text-muted-foreground text-sm">Published by</dt>
										<dd className="break-words">
											{entry.publisher && entry.publishedAt ? (
												<>
													{entry.publisher.name} — <ManilaTime value={entry.publishedAt} />
												</>
											) : (
												"Not published"
											)}
										</dd>
									</div>
									<div className="min-w-0">
										<dt className="text-muted-foreground text-sm">Comments</dt>
										<dd className="break-words">{entry.transitionComments ?? "None"}</dd>
									</div>
								</dl>

								<section aria-label={`Differences for version ${entry.versionNo}`}>
									<h3 className="mb-2 text-sm font-medium">Differences from the current version</h3>
									<VersionDifferences entry={entry} />
								</section>

								{canRestore && entry.restorable ? (
									<AlertDialog
										open={openVersionNo === entry.versionNo}
										onOpenChange={open => {
											setOpenVersionNo(open ? entry.versionNo : null)
											if (!open) setCommentsError(null)
										}}
									>
										<AlertDialogTrigger
											render={
												<Button
													type="button"
													variant="secondary"
													className="min-h-11 touch-manipulation transition-colors"
													disabled={restore.isPending}
												/>
											}
										>
											Restore Version {entry.versionNo}
										</AlertDialogTrigger>
										<AlertDialogContent className="overscroll-contain">
											<AlertDialogHeader>
												<AlertDialogTitle>Restore Version {entry.versionNo}?</AlertDialogTitle>
												<AlertDialogDescription>
													This creates a new approved version copying version {entry.versionNo}. It
													does not publish anything — the live content stays live until the restored
													version is published.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<div className="space-y-2">
												<Label htmlFor={`restore-comments-${entry.versionNo}`}>
													Reason for restoring
												</Label>
												<Textarea
													ref={commentsRef}
													id={`restore-comments-${entry.versionNo}`}
													name="comments"
													autoComplete="off"
													maxLength={2000}
													value={comments}
													aria-invalid={commentsError !== null}
													aria-describedby={
														commentsError
															? `restore-comments-error-${entry.versionNo}`
															: `restore-comments-help-${entry.versionNo}`
													}
													onChange={event => {
														setComments(event.target.value)
														setCommentsError(null)
													}}
												/>
												<p
													id={`restore-comments-help-${entry.versionNo}`}
													className="text-muted-foreground text-sm"
												>
													Recorded in the audit trail. Plain text only, up to 2,000 characters.
												</p>
												{commentsError ? (
													<p
														id={`restore-comments-error-${entry.versionNo}`}
														role="alert"
														className="text-destructive text-sm"
													>
														{commentsError}
													</p>
												) : null}
											</div>
											<AlertDialogFooter>
												<AlertDialogCancel
													className="min-h-11 touch-manipulation transition-colors"
													disabled={restore.isPending}
												>
													Cancel
												</AlertDialogCancel>
												<AlertDialogAction
													type="button"
													className="min-h-11 touch-manipulation transition-colors"
													disabled={restore.isPending}
													onClick={() => runRestore(entry.versionNo)}
												>
													{restore.isPending ? (
														<span role="status" aria-live="polite">
															Restoring version…
														</span>
													) : (
														"Confirm Restore"
													)}
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								) : null}
							</CardContent>
						</Card>
					</li>
				))}
			</ol>

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
