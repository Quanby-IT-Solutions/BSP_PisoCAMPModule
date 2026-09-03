import { z } from "zod"

import { EngagementRangeInputSchema } from "./engagement.schema.js"

const NonNegativeInt = z.number().int().nonnegative()
const Ratio = z.number().min(0).max(100)

export const PUSH_PLATFORMS = ["android", "ios", "web"] as const
export const PushPlatformSchema = z.enum(PUSH_PLATFORMS)

/**
 * §3.2 opt-in.
 *
 * The token is the store's own device token; the module never invents one, and
 * opting out removes it rather than disabling it.
 */
export const PushSubscribeInputSchema = z
	.object({
		deviceToken: z.string().trim().min(16).max(512),
		platform: PushPlatformSchema,
	})
	.strict()

export const PushSubscriptionStatusSchema = z
	.object({
		subscribed: z.boolean(),
		platform: PushPlatformSchema.nullable(),
		subscribedAt: z.iso.datetime({ offset: true }).nullable(),
	})
	.strict()

/** What the device reports back about a notification it was sent. */
export const PushReceiptInputSchema = z
	.object({
		notificationId: z.uuid(),
		event: z.enum(["delivered", "opened", "clicked"]),
	})
	.strict()

export const PushReceiptOutputSchema = z
	.object({
		notificationId: z.uuid(),
		status: z.enum(["queued", "delivered", "failed"]),
		opened: z.boolean(),
		clicked: z.boolean(),
	})
	.strict()

/**
 * A send.
 *
 * The approval reference is required rather than optional: §3.2 allows only
 * BSP-approved text, and a record of what was sent without a record of who
 * approved it cannot show that rule was kept.
 */
export const SendPushNotificationInputSchema = z
	.object({
		title: z.string().trim().min(1).max(120),
		body: z.string().trim().min(1).max(500),
		// An internal destination only: a push that could open any URL would be
		// a phishing surface with BSP's name on it.
		deepLink: z
			.string()
			.trim()
			.regex(/^\/[A-Za-z0-9/_.:-]{0,200}$/u, "A deep link is an internal path")
			.nullable()
			.default(null),
		approvalReference: z.string().trim().min(1).max(120),
	})
	.strict()

export const SendPushNotificationOutputSchema = z
	.object({
		notificationId: z.uuid(),
		recipients: NonNegativeInt,
		delivered: NonNegativeInt,
		failed: NonNegativeInt,
		queued: NonNegativeInt,
		/** False when no push service is configured; nothing was dispatched. */
		dispatched: z.boolean(),
	})
	.strict()

export const PushNotificationSummarySchema = z
	.object({
		id: z.uuid(),
		title: z.string(),
		sentAt: z.iso.datetime({ offset: true }),
		recipients: NonNegativeInt,
		delivered: NonNegativeInt,
		failed: NonNegativeInt,
		opened: NonNegativeInt,
		clicked: NonNegativeInt,
	})
	.strict()

/** AN-014. */
export const PushMetricsSchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		registeredAccounts: NonNegativeInt,
		optedInAccounts: NonNegativeInt,
		optInRatePercent: Ratio,
		sent: NonNegativeInt,
		recipients: NonNegativeInt,
		delivered: NonNegativeInt,
		failed: NonNegativeInt,
		opened: NonNegativeInt,
		clicked: NonNegativeInt,
		deliveryRatePercent: Ratio,
		failedDeliveryRatePercent: Ratio,
		/** Opened ÷ delivered: something that never arrived was never ignored. */
		openRatePercent: Ratio,
		clickRatePercent: Ratio,
		/** Opens followed by a session within 24 hours. */
		reengagedOpens: NonNegativeInt,
		reengagementRatePercent: Ratio,
		notifications: z.array(PushNotificationSummarySchema),
	})
	.strict()

export const PushMetricsRangeInputSchema = EngagementRangeInputSchema

export type PushPlatform = z.infer<typeof PushPlatformSchema>
export type PushSubscribeInput = z.infer<typeof PushSubscribeInputSchema>
export type PushSubscriptionStatus = z.infer<typeof PushSubscriptionStatusSchema>
export type PushReceiptInput = z.infer<typeof PushReceiptInputSchema>
export type SendPushNotificationInput = z.infer<typeof SendPushNotificationInputSchema>
export type SendPushNotificationOutput = z.infer<typeof SendPushNotificationOutputSchema>
export type PushMetrics = z.infer<typeof PushMetricsSchema>
