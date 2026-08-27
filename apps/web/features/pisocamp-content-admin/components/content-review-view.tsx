"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
	ApprovePisoCampContentInputSchema,
	type PisoCampContentReviewDetail,
	type PisoCampContentWorkflowAction,
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
	useApprovePisoCampContentMutation,
	usePisoCampContentReviewDetailQuery,
	usePublishPisoCampContentMutation,
	useRejectPisoCampContentMutation,
} from "@/features/pisocamp-content-admin/api/content.hooks"

const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZone: "Asia/Manila",
})

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

type Feedback = {
	tone: "error" | "success"
	message: string
	conflict?: boolean
}

export function ContentReviewView({
	canApprove,
	canPublish,
	itemId,
}: {
	canApprove: boolean
	canPublish: boolean
	itemId: string
}) {
	const review = usePisoCampContentReviewDetailQuery({ itemId })
	const approve = useApprovePisoCampContentMutation()
	const reject = useRejectPisoCampContentMutation()
	const publish = usePublishPisoCampContentMutation()
	const [comments, setComments] = useState("")
	const [commentsError, setCommentsError] = useState<string | null>(null)
	const [activeAction, setActiveAction] = useState<PisoCampContentWorkflowAction | null>(null)
	const [feedback, setFeedback] = useState<Feedback | null>(null)
	const [publishOpen, setPublishOpen] = useState(false)
	const commentsRef = useRef<HTMLTextAreaElement>(null)
	const feedbackRef = useRef<HTMLDivElement>(null)
	const loadErrorRef = useRef<HTMLDivElement>(null)
	const inFlight = useRef(false)
	const requestIds = useRef<Partial<Record<PisoCampContentWorkflowAction, string>>>({})
	const pendingPublishError = useRef<{ error: unknown } | null>(null)

	useEffect(() => {
		if (review.isError) loadErrorRef.current?.focus()
	}, [review.isError])

	useEffect(() => {
		if (!feedback) return
		const frame = requestAnimationFrame(() => feedbackRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [feedback])

	if (review.isPending) {
		return (
			<div role="status" aria-label="Loading review details…" className="space-y-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-96 w-full" />
				<span className="sr-only">Loading review details…</span>
			</div>
		)
	}

	if (review.isError || !review.data) {
		return (
			<Alert ref={loadErrorRef} tabIndex={-1} role="alert" variant="destructive">
				<AlertTitle>Could Not Load Review Details</AlertTitle>
				<AlertDescription>
					Check your connection and access, then try again.
					<Button
						type="button"
						variant="outline"
						className="mt-3 min-h-11 touch-manipulation transition-colors"
						onClick={() => review.refetch()}
					>
						Try Again
					</Button>
				</AlertDescription>
			</Alert>
		)
	}

	const detail = review.data
	const pending =
		activeAction !== null || approve.isPending || reject.isPending || publish.isPending

	function requestIdFor(action: PisoCampContentWorkflowAction) {
		requestIds.current[action] ??= crypto.randomUUID()
		return requestIds.current[action]
	}

	function completeAction(action: PisoCampContentWorkflowAction, message: string) {
		inFlight.current = false
		setActiveAction(null)
		setFeedback({ tone: "success", message })
		requestIds.current[action] = undefined
		setComments("")
		setCommentsError(null)
		if (action === "publish") setPublishOpen(false)
		toast.success(message)
	}

	function failAction(error: unknown) {
		inFlight.current = false
		setActiveAction(null)
		setFeedback(
			isConflict(error)
				? {
						tone: "error",
						message: "A newer version is available. Reload the latest version before trying again.",
						conflict: true,
					}
				: {
						tone: "error",
						message:
							"Could not complete this workflow action. Check your connection and try again.",
					}
		)
	}

	function runCommentAction(action: "approve" | "reject") {
		if (inFlight.current) return
		const normalizedComments = comments.trim()
		if (!normalizedComments) {
			setCommentsError("Review comments are required.")
			commentsRef.current?.focus()
			return
		}
		if (!ApprovePisoCampContentInputSchema.shape.comments.safeParse(normalizedComments).success) {
			setCommentsError("Review comments must be plain text without HTML.")
			commentsRef.current?.focus()
			return
		}

		inFlight.current = true
		setActiveAction(action)
		setFeedback(null)
		const input = {
			itemId: detail.id,
			requestId: requestIdFor(action),
			expectedVersionNo: detail.currentVersion.versionNo,
			comments: normalizedComments,
		}
		const callbacks = {
			onSuccess: () =>
				completeAction(action, action === "approve" ? "Content approved." : "Content rejected."),
			onError: failAction,
		}
		if (action === "approve") approve.mutate(input, callbacks)
		else reject.mutate(input, callbacks)
	}

	function runPublish() {
		if (inFlight.current) return
		inFlight.current = true
		setActiveAction("publish")
		setFeedback(null)
		publish.mutate(
			{
				itemId: detail.id,
				requestId: requestIdFor("publish"),
				expectedVersionNo: detail.currentVersion.versionNo,
			},
			{
				onSuccess: () => completeAction("publish", "Content published."),
				onError: error => {
					pendingPublishError.current = { error }
					setPublishOpen(false)
				},
			}
		)
	}

	return (
		<div data-testid="content-review-layout" className="w-full max-w-full min-w-0 space-y-6">
			<PageHeader
				title={detail.currentVersion.content.title}
				description={`Immutable version ${detail.currentVersion.versionNo} for governed review.`}
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
						{feedback.tone === "error" ? "Action Not Completed" : "Action Completed"}
					</AlertTitle>
					<AlertDescription>
						{feedback.message}
						{feedback.conflict ? (
							<Button
								type="button"
								variant="outline"
								className="mt-3 min-h-11 touch-manipulation transition-colors"
								onClick={() => {
									setFeedback(null)
									void review.refetch()
								}}
							>
								Reload Latest
							</Button>
						) : null}
					</AlertDescription>
				</Alert>
			) : null}

			{activeAction && activeAction !== "publish" ? (
				<p role="status" aria-live="polite" className="sr-only">
					{activeAction === "approve"
						? "Approving content…"
						: activeAction === "reject"
							? "Rejecting content…"
							: "Publishing content…"}
				</p>
			) : null}

			<Card className="min-w-0 overflow-visible">
				<CardHeader>
					<CardTitle as="h2">Immutable Snapshot</CardTitle>
				</CardHeader>
				<CardContent className="min-w-0 space-y-5">
					<div className="space-y-2">
						<p className="text-muted-foreground text-sm">Summary</p>
						<p className="break-words">{detail.currentVersion.content.summary}</p>
					</div>
					{"body" in detail.currentVersion.content && detail.currentVersion.content.body ? (
						<div className="space-y-2">
							<p className="text-muted-foreground text-sm">Body</p>
							<p className="break-words whitespace-pre-wrap">
								{detail.currentVersion.content.body}
							</p>
						</div>
					) : null}
					<ContentSpecificFields detail={detail} />
					<RelatedLinks detail={detail} />
				</CardContent>
			</Card>

			<Card className="min-w-0 overflow-visible">
				<CardHeader>
					<CardTitle as="h2">Workflow History</CardTitle>
				</CardHeader>
				<CardContent>
					<WorkflowMetadata detail={detail} />
				</CardContent>
			</Card>

			{detail.status === "submitted_for_review" && canApprove ? (
				<Card className="min-w-0 overflow-visible">
					<CardHeader>
						<CardTitle as="h2">Review Decision</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="review-comments">Review comments</Label>
							<Textarea
								ref={commentsRef}
								id="review-comments"
								name="comments"
								autoComplete="off"
								maxLength={2000}
								value={comments}
								aria-invalid={commentsError !== null}
								aria-describedby={commentsError ? "review-comments-error" : "review-comments-help"}
								onChange={event => {
									setComments(event.target.value)
									setCommentsError(null)
									requestIds.current.approve = undefined
									requestIds.current.reject = undefined
								}}
							/>
							<p id="review-comments-help" className="text-muted-foreground text-sm">
								Required for approval and rejection. Plain text only, up to 2,000 characters.
							</p>
							{commentsError ? (
								<p id="review-comments-error" role="alert" className="text-destructive text-sm">
									{commentsError}
								</p>
							) : null}
						</div>
						<div className="flex flex-wrap gap-3">
							<Button
								type="button"
								className="min-h-11 touch-manipulation transition-colors"
								disabled={pending}
								onClick={() => runCommentAction("approve")}
							>
								{activeAction === "approve" ? "Approving…" : "Approve"}
							</Button>
							<Button
								type="button"
								variant="destructive"
								className="min-h-11 touch-manipulation transition-colors"
								disabled={pending}
								onClick={() => runCommentAction("reject")}
							>
								{activeAction === "reject" ? "Rejecting…" : "Reject"}
							</Button>
						</div>
					</CardContent>
				</Card>
			) : null}

			{detail.status === "approved" && canPublish ? (
				<Card className="min-w-0 overflow-visible">
					<CardHeader>
						<CardTitle as="h2">Publication</CardTitle>
					</CardHeader>
					<CardContent>
						<AlertDialog
							open={publishOpen}
							onOpenChange={setPublishOpen}
							onOpenChangeComplete={open => {
								if (open || !pendingPublishError.current) return
								const { error } = pendingPublishError.current
								pendingPublishError.current = null
								failAction(error)
							}}
						>
							<AlertDialogTrigger
								render={
									<Button
										type="button"
										className="min-h-11 touch-manipulation transition-colors"
										disabled={pending}
									/>
								}
							>
								Publish Approved Version
							</AlertDialogTrigger>
							<AlertDialogContent className="overscroll-contain">
								<AlertDialogHeader>
									<AlertDialogTitle>Publish Approved Content?</AlertDialogTitle>
									<AlertDialogDescription>
										This publishes immutable version {detail.currentVersion.versionNo} and queues a
										bundle rebuild.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel
										className="min-h-11 touch-manipulation transition-colors"
										disabled={pending}
									>
										Cancel
									</AlertDialogCancel>
									<AlertDialogAction
										type="button"
										className="min-h-11 touch-manipulation transition-colors"
										disabled={pending}
										onClick={runPublish}
									>
										{activeAction === "publish" ? (
											<span role="status" aria-live="polite">
												Publishing content…
											</span>
										) : (
											"Confirm Publication"
										)}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}

function ContentSpecificFields({ detail }: { detail: PisoCampContentReviewDetail }) {
	const content = detail.currentVersion.content
	if (content.contentType === "link") {
		return (
			<div className="space-y-2">
				<p className="text-muted-foreground text-sm">Primary URL</p>
				<a
					className="text-primary hover:text-primary/80 break-all underline underline-offset-4"
					href={content.primaryUrl}
				>
					{content.primaryUrl}
				</a>
			</div>
		)
	}
	if (content.contentType === "advisory") return null

	return (
		<dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
			<div>
				<dt className="text-muted-foreground text-sm">Currency series</dt>
				<dd className="break-words" translate="no">
					{content.seriesCode}
				</dd>
			</div>
			<div>
				<dt className="text-muted-foreground text-sm">Denomination</dt>
				<dd className="break-words" translate="no">
					{content.denominationCode}
				</dd>
			</div>
		</dl>
	)
}

function RelatedLinks({ detail }: { detail: PisoCampContentReviewDetail }) {
	const links = detail.currentVersion.relatedLinks
	if (!links.length) return null

	return (
		<section aria-labelledby="related-links-title" className="min-w-0 space-y-2">
			<h3 id="related-links-title" className="font-medium">
				Related Links
			</h3>
			<ul className="list-disc space-y-2 pl-5">
				{links.map(link => (
					<li key={link.id} className="min-w-0 break-words">
						{link.kind === "external" ? (
							<a
								className="text-primary hover:text-primary/80 break-all underline underline-offset-4"
								href={link.url}
							>
								{link.label}
							</a>
						) : link.kind === "internal" ? (
							<Link
								className="text-primary hover:text-primary/80 underline underline-offset-4"
								href={link.route}
							>
								{link.label}
							</Link>
						) : (
							<span>
								{link.label}: <span translate="no">{link.targetContentItemId}</span>
							</span>
						)}
					</li>
				))}
			</ul>
		</section>
	)
}

function WorkflowMetadata({ detail }: { detail: PisoCampContentReviewDetail }) {
	const version = detail.currentVersion
	return (
		<dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
			<Metadata label="Status">
				<Badge variant="secondary">{titleCase(detail.status)}</Badge>
			</Metadata>
			<Metadata label="Content type">{titleCase(detail.contentType)}</Metadata>
			<Metadata label="Version">
				<span translate="no">{version.versionNo}</span>
			</Metadata>
			<Metadata label="Creator">{detail.creator.name}</Metadata>
			<Metadata label="Last editor">{detail.lastEditor.name}</Metadata>
			<Metadata label="Item created">
				<ManilaTime value={detail.createdAt} />
			</Metadata>
			<Metadata label="Snapshot created by">{version.createdBy.name}</Metadata>
			<Metadata label="Snapshot created">
				<ManilaTime value={version.createdAt} />
			</Metadata>
			<Metadata label="Last modified">
				<ManilaTime value={detail.dateModified} />
			</Metadata>
			<Metadata label="Transition">{titleCase(version.transition.action)}</Metadata>
			<Metadata label="Transition comments">
				{version.transition.comments ?? "No comments"}
			</Metadata>
			{version.approval ? (
				<>
					<Metadata label="Approved by">{version.approval.actor.name}</Metadata>
					<Metadata label="Approved">
						<ManilaTime value={version.approval.at} />
					</Metadata>
				</>
			) : null}
			{version.publication ? (
				<>
					<Metadata label="Published by">{version.publication.actor.name}</Metadata>
					<Metadata label="Published">
						<ManilaTime value={version.publication.at} />
					</Metadata>
				</>
			) : null}
		</dl>
	)
}

function Metadata({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="break-words">{children}</dd>
		</div>
	)
}
