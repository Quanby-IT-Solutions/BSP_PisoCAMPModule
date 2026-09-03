import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, eq, sql } from "drizzle-orm"

import type {
	PushMetrics,
	PushReceiptInput,
	PushSubscribeInput,
	PushSubscriptionStatus,
	SendPushNotificationInput,
	SendPushNotificationOutput,
} from "@repo/contracts/pisocamp-push"
import { pushDeliveries, pushNotifications, pushSubscriptions } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

import { PushDispatcherService } from "./push-dispatcher.service"

const MANILA = "Asia/Manila"

@Injectable()
export class PushService {
	constructor(
		private readonly dispatcher: PushDispatcherService,
		private readonly audit: AuditService
	) {}

	async status(accountId: string): Promise<PushSubscriptionStatus> {
		const [row] = await db
			.select()
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.accountId, accountId))

		return row
			? {
					subscribed: true,
					platform: row.platform,
					subscribedAt: row.createdAt.toISOString(),
				}
			: { subscribed: false, platform: null, subscribedAt: null }
	}

	/**
	 * Opt in.
	 *
	 * A device token belongs to a device, not to a person, so claiming one that
	 * another account holds moves it: a shared handset that two people sign into
	 * must not deliver one person's notification to the other.
	 */
	async subscribe(
		input: PushSubscribeInput,
		accountId: string
	): Promise<PushSubscriptionStatus> {
		return db.transaction(async tx => {
			await tx
				.delete(pushSubscriptions)
				.where(eq(pushSubscriptions.deviceToken, input.deviceToken))
			await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.accountId, accountId))
			const [row] = await tx
				.insert(pushSubscriptions)
				.values({
					accountId,
					deviceToken: input.deviceToken,
					platform: input.platform,
				})
				.returning()

			await this.audit.record(
				{
					domain: "pisocamp",
					action: "push.opt_in",
					actorId: accountId,
					targetType: "push_subscription",
					targetId: row!.id,
					// The token itself is never audited: it is a credential for
					// reaching a device, and an audit trail is not a place to keep
					// one.
					newValue: { platform: input.platform },
				},
				tx
			)

			return {
				subscribed: true,
				platform: row!.platform,
				subscribedAt: row!.createdAt.toISOString(),
			}
		})
	}

	/**
	 * Opt out.
	 *
	 * The row is deleted, not flagged: a subscription kept "disabled" is still a
	 * token the module could send to, and the point of opting out is that it
	 * cannot.
	 */
	async unsubscribe(accountId: string): Promise<PushSubscriptionStatus> {
		return db.transaction(async tx => {
			const removed = await tx
				.delete(pushSubscriptions)
				.where(eq(pushSubscriptions.accountId, accountId))
				.returning()

			if (removed.length > 0) {
				await this.audit.record(
					{
						domain: "pisocamp",
						action: "push.opt_out",
						actorId: accountId,
						targetType: "push_subscription",
						targetId: removed[0]!.id,
					},
					tx
				)
			}

			return { subscribed: false, platform: null, subscribedAt: null }
		})
	}

	/** What the device reports back about a notification it was sent. */
	async recordReceipt(input: PushReceiptInput, accountId: string) {
		const [delivery] = await db
			.select()
			.from(pushDeliveries)
			.where(
				and(
					eq(pushDeliveries.notificationId, input.notificationId),
					eq(pushDeliveries.accountId, accountId)
				)
			)

		if (!delivery) {
			// Nobody may report on a notification they were not sent: the rates
			// would then be reporting on strangers.
			throw new ORPCError("NOT_FOUND", { message: "No such notification for this account" })
		}

		const now = new Date()
		// Each step implies the ones before it: a device that reports a tap
		// without a delivery still received and opened the thing it tapped.
		const delivered = delivery.deliveredAt ?? now
		const opened =
			delivery.openedAt ?? (input.event === "opened" || input.event === "clicked" ? now : null)
		const clicked = delivery.clickedAt ?? (input.event === "clicked" ? now : null)

		const [updated] = await db
			.update(pushDeliveries)
			.set({
				status: "delivered",
				failureReason: null,
				deliveredAt: delivered,
				openedAt: opened,
				clickedAt: clicked,
			})
			.where(eq(pushDeliveries.id, delivery.id))
			.returning()

		return {
			notificationId: input.notificationId,
			status: updated!.status,
			opened: updated!.openedAt !== null,
			clicked: updated!.clickedAt !== null,
		}
	}

	/**
	 * Send an approved notification to everybody opted in.
	 *
	 * "All opted-in" is the whole of the audience by design (segmentation is out
	 * of scope), and the send is written in one transaction with its audit so a
	 * dispatch can never be recorded without the record of who authorised it.
	 */
	async send(
		input: SendPushNotificationInput,
		actorId: string
	): Promise<SendPushNotificationOutput> {
		const subscriptions = await db.select().from(pushSubscriptions)
		const outcomes = await this.dispatcher.dispatch(
			{ title: input.title, body: input.body, deepLink: input.deepLink },
			subscriptions.map(row => ({
				accountId: row.accountId,
				deviceToken: row.deviceToken,
				platform: row.platform,
			}))
		)

		return db.transaction(async tx => {
			const [notification] = await tx
				.insert(pushNotifications)
				.values({
					title: input.title,
					body: input.body,
					deepLink: input.deepLink,
					approvalReference: input.approvalReference,
					sentBy: actorId,
					recipients: subscriptions.length,
				})
				.returning()

			if (outcomes.length > 0) {
				await tx.insert(pushDeliveries).values(
					outcomes.map(outcome => ({
						notificationId: notification!.id,
						accountId: outcome.accountId,
						status: outcome.status,
						failureReason: outcome.status === "failed" ? outcome.reason : null,
						deliveredAt: outcome.status === "delivered" ? new Date() : null,
					}))
				)
			}

			const delivered = outcomes.filter(outcome => outcome.status === "delivered").length
			const failed = outcomes.filter(outcome => outcome.status === "failed").length

			await this.audit.record(
				{
					domain: "pisocamp",
					action: "push.send",
					actorId,
					targetType: "push_notification",
					targetId: notification!.id,
					newValue: {
						approvalReference: input.approvalReference,
						recipients: subscriptions.length,
						delivered,
						failed,
						dispatched: this.dispatcher.configured,
					},
				},
				tx
			)

			return {
				notificationId: notification!.id,
				recipients: subscriptions.length,
				delivered,
				failed,
				queued: outcomes.length - delivered - failed,
				dispatched: this.dispatcher.configured,
			}
		})
	}

	/** AN-014's rates, for a range of Asia/Manila days. */
	async metrics(
		input: V1Inputs["pisocamp"]["admin"]["notifications"]["metrics"]
	): Promise<PushMetrics> {
		const sentRange = sql`
			n.sent_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and n.sent_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`

		const [totals] = (
			await db.execute<{
				accounts: string
				optedIn: string
				sent: string
				recipients: string
				delivered: string
				failed: string
				opened: string
				clicked: string
				reengaged: string
			}>(sql`
				with scoped as (
					select n.id, n.recipients
					from push_notification n
					where ${sentRange}
				), deliveries as (
					select d.*
					from push_delivery d
					join scoped s on s.id = d.notification_id
				)
				select
					(select count(*)::text from users) as "accounts",
					(select count(distinct account_id)::text from push_subscription) as "optedIn",
					(select count(*)::text from scoped) as "sent",
					(select coalesce(sum(recipients), 0)::text from scoped) as "recipients",
					(select count(*) filter (where status = 'delivered')::text from deliveries)
						as "delivered",
					(select count(*) filter (where status = 'failed')::text from deliveries)
						as "failed",
					(select count(*) filter (where opened_at is not null)::text from deliveries)
						as "opened",
					(select count(*) filter (where clicked_at is not null)::text from deliveries)
						as "clicked",
					(
						-- Re-engagement attributable: an open followed by a session
						-- within 24 hours. After, because the question is whether
						-- the notification brought somebody back.
						select count(*)::text from deliveries d
						where d.opened_at is not null
							and exists (
								select 1
								from analytics_session s
								join piso_camp_device_account_link l
									on l.device_pseudo_id = s.subject_pseudo_id
								where l.account_id = d.account_id
									and s.started_at >= d.opened_at
									and s.started_at < d.opened_at + interval '24 hours'
							)
					) as "reengaged"
			`)
		).rows

		const notifications = (
			await db.execute<{
				id: string
				title: string
				sentAt: Date
				recipients: number
				delivered: string
				failed: string
				opened: string
				clicked: string
			}>(sql`
				select
					n.id::text as "id",
					n.title as "title",
					n.sent_at as "sentAt",
					n.recipients as "recipients",
					count(d.id) filter (where d.status = 'delivered')::text as "delivered",
					count(d.id) filter (where d.status = 'failed')::text as "failed",
					count(d.id) filter (where d.opened_at is not null)::text as "opened",
					count(d.id) filter (where d.clicked_at is not null)::text as "clicked"
				from push_notification n
				left join push_delivery d on d.notification_id = n.id
				where ${sentRange}
				group by n.id, n.title, n.sent_at, n.recipients
				order by n.sent_at desc
			`)
		).rows

		const accounts = Number(totals?.accounts ?? 0)
		const optedIn = Number(totals?.optedIn ?? 0)
		const recipients = Number(totals?.recipients ?? 0)
		const delivered = Number(totals?.delivered ?? 0)
		const failed = Number(totals?.failed ?? 0)
		const opened = Number(totals?.opened ?? 0)
		const clicked = Number(totals?.clicked ?? 0)
		const reengaged = Number(totals?.reengaged ?? 0)

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			registeredAccounts: accounts,
			optedInAccounts: optedIn,
			optInRatePercent: this.rate(optedIn, accounts),
			sent: Number(totals?.sent ?? 0),
			recipients,
			delivered,
			failed,
			opened,
			clicked,
			deliveryRatePercent: this.rate(delivered, recipients),
			failedDeliveryRatePercent: this.rate(failed, recipients),
			// Divided by what arrived: something that never arrived was never
			// ignored, and dividing by everything sent would call a delivery
			// failure an unopened notification.
			openRatePercent: this.rate(opened, delivered),
			clickRatePercent: this.rate(clicked, delivered),
			reengagedOpens: reengaged,
			reengagementRatePercent: this.rate(reengaged, opened),
			notifications: notifications.map(row => ({
				id: row.id,
				title: row.title,
				sentAt: new Date(row.sentAt).toISOString(),
				recipients: row.recipients,
				delivered: Number(row.delivered),
				failed: Number(row.failed),
				opened: Number(row.opened),
				clicked: Number(row.clicked),
			})),
		}
	}

	/** Zero rather than a division by zero: an empty pool has no rate. */
	private rate(part: number, whole: number): number {
		if (whole === 0) return 0
		return Math.min(100, Math.round((part / whole) * 10_000) / 100)
	}
}
