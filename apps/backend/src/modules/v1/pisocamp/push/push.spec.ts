import { sql } from "drizzle-orm"

import { auditLog, pushDeliveries, pushSubscriptions, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PushDispatcherService, type PushDispatchOutcome } from "./push-dispatcher.service"
import { PushService } from "./push.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const SENDER = "sa5-sender"
const ALICE = "sa5-alice"
const BOB = "sa5-bob"
const CARA = "sa5-cara"

const ALICE_DEVICE = "Sa5AliceDeviceId000001"

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour = 10) {
	return new Date(Date.UTC(2026, 8, day, hour - 8))
}

/** A dispatcher that answers however the test needs it to. */
class FakeDispatcher extends PushDispatcherService {
	outcome: "delivered" | "failed" | "queued" = "delivered"
	isConfigured = true
	lastTokens: string[] = []

	override get configured() {
		return this.isConfigured
	}

	override async dispatch(
		_message: { title: string; body: string; deepLink: string | null },
		targets: readonly { accountId: string; deviceToken: string }[]
	): Promise<PushDispatchOutcome[]> {
		this.lastTokens = targets.map(target => target.deviceToken)
		return targets.map(target =>
			this.outcome === "failed"
				? { accountId: target.accountId, status: "failed", reason: "push_service_rejected" }
				: { accountId: target.accountId, status: this.outcome }
		)
	}
}

/**
 * SA-5. Opting out removes the token rather than disabling it, a send records
 * what actually happened rather than what was hoped for, and the rates divide
 * by the pool each of them is about.
 */
describe("SA-5 push notifications", () => {
	let service: PushService
	let dispatcher: FakeDispatcher

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table push_delivery, push_notification, push_subscription,
				analytics_session, piso_camp_device_account_link, piso_camp_profile,
				consent_record, privacy_notice, audit_log, sessions, accounts, users
			restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values(
			[SENDER, ALICE, BOB, CARA].map(id => ({
				id,
				name: `SA-5 ${id}`,
				email: `${id}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			}))
		)
		dispatcher = new FakeDispatcher()
		service = new PushService(dispatcher, new AuditService())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	const token = (id: string) => `${id}-device-token-000000`

	async function optIn(accountId: string) {
		return service.subscribe(
			{ deviceToken: token(accountId), platform: "android" },
			accountId
		)
	}

	describe("AC1 — opting in stores a subscription, opting out removes it", () => {
		it("stores the subscription and reports it", async () => {
			const status = await optIn(ALICE)

			expect(status).toMatchObject({ subscribed: true, platform: "android" })
			await expect(service.status(ALICE)).resolves.toMatchObject({ subscribed: true })
			const rows = await db.select().from(pushSubscriptions)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ accountId: ALICE, platform: "android" })
		})

		it("removes the row on opt-out rather than flagging it", async () => {
			await optIn(ALICE)

			const status = await service.unsubscribe(ALICE)

			// A subscription kept "disabled" is still a token the module could
			// send to, and the point of opting out is that it cannot.
			expect(status).toEqual({ subscribed: false, platform: null, subscribedAt: null })
			await expect(db.select().from(pushSubscriptions)).resolves.toEqual([])
		})

		it("moves a device token that another account had claimed", async () => {
			await service.subscribe({ deviceToken: token("shared"), platform: "android" }, ALICE)
			await service.subscribe({ deviceToken: token("shared"), platform: "android" }, BOB)

			const rows = await db.select().from(pushSubscriptions)
			// A shared handset must not deliver Alice's notification to Bob.
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ accountId: BOB })
		})

		it("keeps one subscription per account when the device changes", async () => {
			await service.subscribe({ deviceToken: token("first"), platform: "android" }, ALICE)
			await service.subscribe({ deviceToken: token("second"), platform: "ios" }, ALICE)

			const rows = await db.select().from(pushSubscriptions)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ platform: "ios" })
		})

		it("audits both the opt-in and the opt-out without the token", async () => {
			await optIn(ALICE)
			await service.unsubscribe(ALICE)

			const rows = await db.select().from(auditLog)
			expect(rows.map(row => row.action)).toEqual(["push.opt_in", "push.opt_out"])
			// A device token is a credential for reaching a device, and an audit
			// trail is not a place to keep one.
			expect(JSON.stringify(rows)).not.toContain(token(ALICE))
		})

		it("says plainly when an account has never opted in", async () => {
			await expect(service.status(ALICE)).resolves.toEqual({
				subscribed: false,
				platform: null,
				subscribedAt: null,
			})
		})
	})

	describe("AC2 — a send is dispatched and audited", () => {
		const approved = {
			title: "New banknote features",
			body: "Learn what changed on the 1000-piso note.",
			deepLink: "/pisocamp/banknotes",
			approvalReference: "BSP-COMMS-2026-014",
		}

		it("dispatches to every opted-in account and records the outcome", async () => {
			await optIn(ALICE)
			await optIn(BOB)

			const result = await service.send(approved, SENDER)

			expect(result).toMatchObject({
				recipients: 2,
				delivered: 2,
				failed: 0,
				queued: 0,
				dispatched: true,
			})
			expect(dispatcher.lastTokens.sort()).toEqual([token(ALICE), token(BOB)].sort())
			const deliveries = await db.select().from(pushDeliveries)
			expect(deliveries).toHaveLength(2)
			expect(deliveries.every(row => row.status === "delivered")).toBe(true)
		})

		it("records a failure with its reason rather than a silent success", async () => {
			await optIn(ALICE)
			dispatcher.outcome = "failed"

			const result = await service.send(approved, SENDER)

			expect(result).toMatchObject({ delivered: 0, failed: 1 })
			const [delivery] = await db.select().from(pushDeliveries)
			expect(delivery).toMatchObject({
				status: "failed",
				failureReason: "push_service_rejected",
				deliveredAt: null,
			})
		})

		it("queues rather than claiming a delivery when no service is configured", async () => {
			await optIn(ALICE)
			dispatcher.isConfigured = false
			dispatcher.outcome = "queued"

			const result = await service.send(approved, SENDER)

			// Recording a delivery nobody made would make the delivery rate a
			// fiction; recording a failure would blame a service never asked.
			expect(result).toMatchObject({ delivered: 0, failed: 0, queued: 1, dispatched: false })
		})

		it("audits the send with who approved the text", async () => {
			await optIn(ALICE)

			const result = await service.send(approved, SENDER)

			const rows = await db
				.select()
				.from(auditLog)
				.where(sql`action = 'push.send'`)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				actorId: SENDER,
				targetType: "push_notification",
				targetId: result.notificationId,
				newValue: { approvalReference: "BSP-COMMS-2026-014", recipients: 1 },
			})
		})

		it("sends to nobody when nobody has opted in", async () => {
			const result = await service.send(approved, SENDER)

			expect(result).toMatchObject({ recipients: 0, delivered: 0 })
			await expect(db.select().from(pushDeliveries)).resolves.toEqual([])
		})
	})

	describe("AC3 — the rates", () => {
		const approved = {
			title: "New banknote features",
			body: "Learn what changed.",
			deepLink: null,
			approvalReference: "BSP-COMMS-2026-014",
		}

		async function linkDevice(accountId: string, devicePseudoId: string) {
			const consentId = "11111111-1111-4111-8111-111111111111".replace(
				"111111111111$",
				"111111111111"
			)
			await db.execute(sql`
				insert into privacy_notice (id, version, title, body, source_url, content_sha256, effective_at)
				values (${consentId}, 'sa5-notice', 'SA5 notice', 'Body copy.',
				        'https://www.bsp.gov.ph/privacy', repeat('e', 64), now())
				on conflict do nothing
			`)
			const grant = crypto.randomUUID()
			await db.execute(sql`
				insert into consent_record (id, account_id, purpose, notice_id, notice_version, status, responded_at)
				values (${grant}, ${accountId}, 'registration', ${consentId}, 'sa5-notice', 'granted', now())
			`)
			await db.execute(sql`
				insert into piso_camp_device_account_link
					(device_pseudo_id, account_id, registration_consent_record_id)
				values (${devicePseudoId}, ${accountId}, ${grant})
			`)
		}

		async function session(devicePseudoId: string, startedAt: Date) {
			await db.execute(sql`
				insert into analytics_session
					(subject_pseudo_id, started_at, ended_at, local_date, duration_seconds,
					 event_count, screen_view_count)
				values (${devicePseudoId}, ${startedAt.toISOString()},
				        ${new Date(startedAt.getTime() + 300_000).toISOString()},
				        ${startedAt.toISOString().slice(0, 10)}, 300, 4, 2)
			`)
		}

		it("computes opt-in, delivery, open, click and failure rates", async () => {
			await optIn(ALICE)
			await optIn(BOB)
			const sent = await service.send(approved, SENDER)
			await service.recordReceipt(
				{ notificationId: sent.notificationId, event: "clicked" },
				ALICE
			)

			const metrics = await service.metrics(RANGE)

			expect(metrics).toMatchObject({
				registeredAccounts: 4,
				optedInAccounts: 2,
				// Two of the four accounts opted in.
				optInRatePercent: 50,
				sent: 1,
				recipients: 2,
				delivered: 2,
				failed: 0,
				opened: 1,
				clicked: 1,
				deliveryRatePercent: 100,
				failedDeliveryRatePercent: 0,
				// Opened over delivered, not over everything sent.
				openRatePercent: 50,
				clickRatePercent: 50,
			})
			expect(metrics.notifications).toHaveLength(1)
			expect(metrics.notifications[0]).toMatchObject({ opened: 1, clicked: 1 })
		})

		it("divides opens by what arrived, not by what was attempted", async () => {
			await optIn(ALICE)
			await optIn(BOB)
			dispatcher.outcome = "failed"
			await service.send(approved, SENDER)

			const metrics = await service.metrics(RANGE)

			// Nothing arrived, so nothing could be ignored: a 0% open rate over
			// two failures would blame people for a delivery problem.
			expect(metrics).toMatchObject({
				delivered: 0,
				failed: 2,
				failedDeliveryRatePercent: 100,
				openRatePercent: 0,
			})
		})

		it("counts an open followed by a session within a day as re-engagement", async () => {
			await optIn(ALICE)
			await linkDevice(ALICE, ALICE_DEVICE)
			const sent = await service.send(approved, SENDER)
			await service.recordReceipt(
				{ notificationId: sent.notificationId, event: "opened" },
				ALICE
			)
			await session(ALICE_DEVICE, new Date(Date.now() + 60_000))

			const metrics = await service.metrics(RANGE)

			expect(metrics).toMatchObject({ opened: 1, reengagedOpens: 1, reengagementRatePercent: 100 })
		})

		it("does not count a session from before the notification was opened", async () => {
			await optIn(ALICE)
			await linkDevice(ALICE, ALICE_DEVICE)
			await session(ALICE_DEVICE, manila(2))
			const sent = await service.send(approved, SENDER)
			await service.recordReceipt(
				{ notificationId: sent.notificationId, event: "opened" },
				ALICE
			)

			const metrics = await service.metrics(RANGE)

			// Something that happened first cannot have been caused by it.
			expect(metrics).toMatchObject({ opened: 1, reengagedOpens: 0 })
		})

		it("reports zero rather than dividing by an empty pool", async () => {
			const metrics = await service.metrics(RANGE)

			expect(metrics).toMatchObject({
				optInRatePercent: 0,
				deliveryRatePercent: 0,
				openRatePercent: 0,
				reengagementRatePercent: 0,
				notifications: [],
			})
		})
	})

	describe("receipts", () => {
		const approved = {
			title: "Title",
			body: "Body",
			deepLink: null,
			approvalReference: "BSP-COMMS-2026-014",
		}

		it("treats a tap as an open as well, because it was", async () => {
			await optIn(ALICE)
			const sent = await service.send(approved, SENDER)

			const receipt = await service.recordReceipt(
				{ notificationId: sent.notificationId, event: "clicked" },
				ALICE
			)

			expect(receipt).toMatchObject({ opened: true, clicked: true })
		})

		it("refuses a receipt from somebody who was not sent it", async () => {
			await optIn(ALICE)
			const sent = await service.send(approved, SENDER)

			// Otherwise the rates would be reporting on strangers.
			await expect(
				service.recordReceipt({ notificationId: sent.notificationId, event: "opened" }, CARA)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
		})
	})
})
