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
	useNotificationMetricsQuery,
	useSendNotificationMutation,
} from "@/features/notifications/api/notifications.hooks"
import {
	AnalyticsRangeCard,
	daysBefore,
	manilaToday,
} from "@/features/analytics/components/analytics-range-card"

const number = new Intl.NumberFormat("en-US")
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

export function NotificationsDashboard({ canSend }: { canSend: boolean }) {
	const today = manilaToday()
	const [range, setRange] = useState({ from: daysBefore(today, 29), to: today })
	const metrics = useNotificationMetricsQuery(range)

	return (
		<div className="space-y-6">
			<PageHeader
				title="Notifications"
				description="Opt-in, delivery and re-engagement for approved push notifications."
			/>

			<AnalyticsRangeCard idPrefix="notifications" initial={range} onApply={setRange} />

			{canSend ? <SendForm /> : null}

			{metrics.isPending ? (
				<div role="status" aria-label="Loading notification metrics" className="space-y-3">
					<Skeleton className="h-32 w-full" />
					<span className="sr-only">Loading notification metrics</span>
				</div>
			) : metrics.isError || !metrics.data ? (
				<Alert variant="destructive">
					<AlertTitle>Could not load notification metrics</AlertTitle>
					<AlertDescription>
						Check your connection or access, then try again.
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-3"
							onClick={() => metrics.refetch()}
						>
							Try Again
						</Button>
					</AlertDescription>
				</Alert>
			) : (
				<>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						<Figure
							label="Opt-in rate"
							value={`${decimal.format(metrics.data.optInRatePercent)}%`}
							hint={`${number.format(metrics.data.optedInAccounts)} of ${number.format(
								metrics.data.registeredAccounts
							)} registered`}
						/>
						<Figure
							label="Delivery rate"
							value={`${decimal.format(metrics.data.deliveryRatePercent)}%`}
							hint={`${number.format(metrics.data.delivered)} of ${number.format(
								metrics.data.recipients
							)} attempted`}
						/>
						<Figure
							label="Failed delivery rate"
							value={`${decimal.format(metrics.data.failedDeliveryRatePercent)}%`}
							hint={`${number.format(metrics.data.failed)} failures`}
						/>
						<Figure
							label="Open rate"
							value={`${decimal.format(metrics.data.openRatePercent)}%`}
							hint={`${number.format(metrics.data.opened)} of what arrived`}
						/>
						<Figure
							label="Click rate"
							value={`${decimal.format(metrics.data.clickRatePercent)}%`}
							hint={`${number.format(metrics.data.clicked)} taps`}
						/>
						<Figure
							label="Re-engagement"
							value={`${decimal.format(metrics.data.reengagementRatePercent)}%`}
							hint={`${number.format(
								metrics.data.reengagedOpens
							)} opens followed by a session within 24 hours`}
						/>
					</div>

					<Card>
						<CardHeader>
							<CardTitle>Sent in this range</CardTitle>
							<CardDescription>
								{number.format(metrics.data.sent)} notification
								{metrics.data.sent === 1 ? "" : "s"}. Open and click rates are over what
								arrived: something that never arrived was never ignored.
							</CardDescription>
						</CardHeader>
						<CardContent className="min-w-0 overflow-x-auto">
							{metrics.data.notifications.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									Nothing was sent in this range.
								</p>
							) : (
								<table className="w-full min-w-0 text-sm">
									<caption className="sr-only">Notifications sent in the range</caption>
									<thead>
										<tr className="text-left">
											<th scope="col" className="py-2 pr-4">
												Sent
											</th>
											<th scope="col" className="py-2 pr-4">
												Title
											</th>
											<th scope="col" className="py-2 pr-4">
												Recipients
											</th>
											<th scope="col" className="py-2 pr-4">
												Delivered
											</th>
											<th scope="col" className="py-2 pr-4">
												Failed
											</th>
											<th scope="col" className="py-2 pr-4">
												Opened
											</th>
											<th scope="col" className="py-2">
												Clicked
											</th>
										</tr>
									</thead>
									<tbody>
										{metrics.data.notifications.map(notification => (
											<tr key={notification.id} className="border-t">
												<td className="py-2 pr-4">
													{notification.sentAt.slice(0, 10)}
												</td>
												<td className="py-2 pr-4">{notification.title}</td>
												<td className="py-2 pr-4">
													{number.format(notification.recipients)}
												</td>
												<td className="py-2 pr-4">
													{number.format(notification.delivered)}
												</td>
												<td className="py-2 pr-4">{number.format(notification.failed)}</td>
												<td className="py-2 pr-4">{number.format(notification.opened)}</td>
												<td className="py-2">{number.format(notification.clicked)}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}

/**
 * The send form.
 *
 * Everybody opted in is the whole audience by design: segmentation is out of
 * scope, and a form that implied otherwise would promise something the module
 * does not do.
 */
function SendForm() {
	const send = useSendNotificationMutation()
	const [error, setError] = useState<string | null>(null)
	const [sent, setSent] = useState<string | null>(null)
	const [confirming, setConfirming] = useState(false)

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = event.currentTarget
		const data = new FormData(form)
		const deepLink = String(data.get("deepLink") ?? "").trim()

		if (deepLink.length > 0 && !deepLink.startsWith("/")) {
			setError("A deep link is an internal path, so it starts with a slash.")
			return
		}
		if (!confirming) {
			// Sending reaches every opted-in device at once and cannot be taken
			// back, so it asks first.
			setConfirming(true)
			setError(null)
			return
		}

		setError(null)
		setConfirming(false)
		send.mutate(
			{
				title: String(data.get("title")).trim(),
				body: String(data.get("body")).trim(),
				deepLink: deepLink.length === 0 ? null : deepLink,
				approvalReference: String(data.get("approvalReference")).trim(),
			},
			{
				onSuccess: result => {
					setSent(
						result.dispatched
							? `Sent to ${result.recipients} device${result.recipients === 1 ? "" : "s"}: ` +
									`${result.delivered} delivered, ${result.failed} failed.`
							: `Queued for ${result.recipients} device${
									result.recipients === 1 ? "" : "s"
								}. No push service is configured, so nothing has been dispatched yet.`
					)
					form.reset()
				},
				onError: () => setError("The notification was not sent. Check the text and try again."),
			}
		)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Send an approved notification</CardTitle>
				<CardDescription>
					Goes to every opted-in account. Only BSP-approved text may be sent, and the
					approval reference is recorded with it.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-4" onSubmit={submit}>
					<div className="min-w-0 space-y-2">
						<Label htmlFor="notification-title">Title</Label>
						<Input
							id="notification-title"
							name="title"
							required
							maxLength={120}
							className="min-h-11"
						/>
					</div>
					<div className="min-w-0 space-y-2">
						<Label htmlFor="notification-body">Message</Label>
						<Textarea id="notification-body" name="body" required rows={3} maxLength={500} />
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="min-w-0 space-y-2">
							<Label htmlFor="notification-deep-link">Deep link (optional)</Label>
							<Input
								id="notification-deep-link"
								name="deepLink"
								placeholder="/pisocamp/banknotes"
								className="min-h-11"
							/>
						</div>
						<div className="min-w-0 space-y-2">
							<Label htmlFor="notification-approval">Approval reference</Label>
							<Input
								id="notification-approval"
								name="approvalReference"
								required
								maxLength={120}
								placeholder="BSP-COMMS-2026-014"
								className="min-h-11"
							/>
						</div>
					</div>
					{confirming ? (
						<Alert>
							<AlertTitle>This goes to every opted-in device</AlertTitle>
							<AlertDescription>
								A notification cannot be taken back. Press Send again to confirm, or
								change the text first.
							</AlertDescription>
						</Alert>
					) : null}
					<div className="flex flex-wrap items-center gap-4">
						<Button type="submit" className="min-h-11" disabled={send.isPending}>
							{send.isPending ? "Sending…" : confirming ? "Send Now" : "Send"}
						</Button>
						{confirming ? (
							<Button
								type="button"
								variant="outline"
								className="min-h-11"
								onClick={() => setConfirming(false)}
							>
								Cancel
							</Button>
						) : null}
						{error ? (
							<p id="notification-error" role="alert" className="text-destructive text-sm">
								{error}
							</p>
						) : null}
						{sent ? (
							<p role="status" className="text-muted-foreground text-sm">
								{sent}
							</p>
						) : null}
					</div>
				</form>
			</CardContent>
		</Card>
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
