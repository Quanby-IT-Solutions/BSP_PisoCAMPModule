"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import type { PisoCampContentReviewDetail } from "@repo/contracts"

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
import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
	useArchivePisoCampContentMutation,
	useDeactivatePisoCampContentMutation,
	useSchedulePisoCampContentPublicationMutation,
	useUnpublishPisoCampContentMutation,
} from "@/features/pisocamp-content-admin/api/content.hooks"

type WithdrawalAction = "unpublish" | "deactivate" | "archive"

const WITHDRAWAL_COPY: Record<
	WithdrawalAction,
	{ label: string; title: string; description: string; success: string }
> = {
	unpublish: {
		label: "Unpublish",
		title: "Unpublish this content?",
		description:
			"It is removed from the app at the next bundle build. Every version stays on record and it can be published again later.",
		success: "Content unpublished. It leaves the app at the next bundle build.",
	},
	deactivate: {
		label: "Deactivate",
		title: "Deactivate this content?",
		description:
			"Deactivated content is never presented to end users again — not in Currency Education, and not in trivia selection.",
		success: "Content deactivated. It is no longer presented to end users.",
	},
	archive: {
		label: "Archive",
		title: "Archive this content?",
		description:
			"Archived content becomes read-only and drops out of the default lists. It is retained, not deleted.",
		success: "Content archived. It is retained as read-only history.",
	},
}

/**
 * Turn a UTC instant into the value a `datetime-local` input wants, in the
 * viewer's own timezone. The input has no timezone of its own, so the
 * conversion has to be explicit in both directions.
 */
function toLocalInputValue(isoUtc: string | null): string {
	if (!isoUtc) return ""
	const instant = new Date(isoUtc)
	const offsetMinutes = instant.getTimezoneOffset()
	return new Date(instant.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 16)
}

function fromLocalInputValue(value: string): string | null {
	if (!value) return null
	const instant = new Date(value)
	return Number.isNaN(instant.getTime()) ? null : instant.toISOString()
}

function isConflict(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		(("status" in error && error.status === 409) || ("code" in error && error.code === "CONFLICT"))
	)
}

/**
 * CM-6 withdrawal and scheduling controls.
 *
 * Rendered next to the review screen's decision controls so one screen carries
 * the whole lifecycle. Every destructive step is behind a confirmation that
 * spells out what end users will see.
 */
export function ContentLifecycleActions({
	canPublish,
	detail,
}: {
	canPublish: boolean
	detail: PisoCampContentReviewDetail
}) {
	const unpublish = useUnpublishPisoCampContentMutation()
	const deactivate = useDeactivatePisoCampContentMutation()
	const archive = useArchivePisoCampContentMutation()
	const schedule = useSchedulePisoCampContentPublicationMutation()

	const [openAction, setOpenAction] = useState<WithdrawalAction | null>(null)
	const [publishAtValue, setPublishAtValue] = useState(() => toLocalInputValue(detail.publishAt))
	const [scheduleError, setScheduleError] = useState<string | null>(null)
	const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(
		null
	)
	const feedbackRef = useRef<HTMLDivElement>(null)
	const scheduleRef = useRef<HTMLInputElement>(null)
	const inFlight = useRef(false)
	const requestIds = useRef<Record<string, string>>({})

	useEffect(() => {
		setPublishAtValue(toLocalInputValue(detail.publishAt))
	}, [detail.publishAt])

	useEffect(() => {
		if (!feedback) return
		const frame = requestAnimationFrame(() => feedbackRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [feedback])

	if (!canPublish) return null

	const available: WithdrawalAction[] =
		detail.status === "published"
			? ["unpublish", "deactivate"]
			: detail.status === "unpublished"
				? ["deactivate"]
				: detail.status === "deactivated"
					? ["archive"]
					: []
	const canSchedule = detail.status === "approved"
	if (!available.length && !canSchedule) return null

	const pending =
		unpublish.isPending || deactivate.isPending || archive.isPending || schedule.isPending

	function requestIdFor(key: string) {
		requestIds.current[key] ??= crypto.randomUUID()
		return requestIds.current[key]!
	}

	function fail(error: unknown) {
		inFlight.current = false
		setOpenAction(null)
		setFeedback({
			tone: "error",
			message: isConflict(error)
				? "This content changed while you were reading. Reload and try again."
				: "Could not complete this action. Check your connection and try again.",
		})
	}

	function runWithdrawal(action: WithdrawalAction) {
		if (inFlight.current) return
		inFlight.current = true
		setFeedback(null)
		const input = {
			itemId: detail.id,
			requestId: requestIdFor(action),
			expectedVersionNo: detail.currentVersion.versionNo,
		}
		const callbacks = {
			onSuccess: () => {
				inFlight.current = false
				requestIds.current[action] = undefined as unknown as string
				setOpenAction(null)
				setFeedback({ tone: "success", message: WITHDRAWAL_COPY[action].success })
				toast.success(WITHDRAWAL_COPY[action].success)
			},
			onError: fail,
		}
		if (action === "unpublish") unpublish.mutate(input, callbacks)
		else if (action === "deactivate") deactivate.mutate(input, callbacks)
		else archive.mutate(input, callbacks)
	}

	function runSchedule(publishAt: string | null) {
		if (inFlight.current) return
		if (publishAt !== null && new Date(publishAt).getTime() <= Date.now()) {
			setScheduleError("Choose a time in the future.")
			scheduleRef.current?.focus()
			return
		}
		inFlight.current = true
		setScheduleError(null)
		setFeedback(null)
		schedule.mutate(
			{
				itemId: detail.id,
				requestId: requestIdFor(`schedule:${publishAt ?? "clear"}`),
				expectedVersionNo: detail.currentVersion.versionNo,
				publishAt,
			},
			{
				onSuccess: () => {
					inFlight.current = false
					requestIds.current[`schedule:${publishAt ?? "clear"}`] = undefined as unknown as string
					setFeedback({
						tone: "success",
						message:
							publishAt === null
								? "Scheduled publication cleared."
								: "Publication scheduled. It publishes automatically at that time.",
					})
					toast.success(publishAt === null ? "Schedule cleared." : "Publication scheduled.")
				},
				onError: fail,
			}
		)
	}

	return (
		<Card data-testid="content-lifecycle-actions" className="min-w-0 overflow-visible">
			<CardHeader>
				<CardTitle as="h2">Publication Lifecycle</CardTitle>
			</CardHeader>
			<CardContent className="min-w-0 space-y-4">
				{feedback ? (
					<Alert
						ref={feedbackRef}
						tabIndex={-1}
						role={feedback.tone === "error" ? "alert" : "status"}
						aria-live={feedback.tone === "error" ? "assertive" : "polite"}
						variant={feedback.tone === "error" ? "destructive" : "default"}
					>
						<AlertTitle>
							{feedback.tone === "error" ? "Action Not Completed" : "Lifecycle Updated"}
						</AlertTitle>
						<AlertDescription>{feedback.message}</AlertDescription>
					</Alert>
				) : null}

				{canSchedule ? (
					<div className="min-w-0 space-y-2">
						<Label htmlFor="publish-at">Scheduled publication</Label>
						<Input
							ref={scheduleRef}
							id="publish-at"
							name="publishAt"
							type="datetime-local"
							className="min-h-11 w-full min-w-0"
							value={publishAtValue}
							aria-invalid={scheduleError !== null}
							aria-describedby={scheduleError ? "publish-at-error" : "publish-at-help"}
							onChange={event => {
								setPublishAtValue(event.target.value)
								setScheduleError(null)
							}}
						/>
						<p id="publish-at-help" className="text-muted-foreground text-sm">
							{detail.publishAt
								? "This content publishes automatically at the time shown, in your device's timezone."
								: "Leave empty to publish by hand. A scheduled time publishes it automatically."}
						</p>
						{scheduleError ? (
							<p id="publish-at-error" role="alert" className="text-destructive text-sm">
								{scheduleError}
							</p>
						) : null}
						<div className="flex flex-wrap gap-3">
							<Button
								type="button"
								className="min-h-11 touch-manipulation transition-colors"
								disabled={pending || publishAtValue === ""}
								onClick={() => runSchedule(fromLocalInputValue(publishAtValue))}
							>
								{schedule.isPending ? "Saving schedule…" : "Save Schedule"}
							</Button>
							<Button
								type="button"
								variant="outline"
								className="min-h-11 touch-manipulation transition-colors"
								disabled={pending || detail.publishAt === null}
								onClick={() => runSchedule(null)}
							>
								Clear Schedule
							</Button>
						</div>
					</div>
				) : null}

				{available.length ? (
					<div className="flex flex-wrap gap-3">
						{available.map(action => (
							<AlertDialog
								key={action}
								open={openAction === action}
								onOpenChange={open => setOpenAction(open ? action : null)}
							>
								<AlertDialogTrigger
									render={
										<Button
											type="button"
											variant={action === "unpublish" ? "secondary" : "destructive"}
											className="min-h-11 touch-manipulation transition-colors"
											disabled={pending}
										/>
									}
								>
									{WITHDRAWAL_COPY[action].label}
								</AlertDialogTrigger>
								<AlertDialogContent className="overscroll-contain">
									<AlertDialogHeader>
										<AlertDialogTitle>{WITHDRAWAL_COPY[action].title}</AlertDialogTitle>
										<AlertDialogDescription>
											{WITHDRAWAL_COPY[action].description}
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
											onClick={() => runWithdrawal(action)}
										>
											{pending ? (
												<span role="status" aria-live="polite">
													Working…
												</span>
											) : (
												`Confirm ${WITHDRAWAL_COPY[action].label}`
											)}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						))}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
