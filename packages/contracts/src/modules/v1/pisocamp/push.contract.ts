import { oc } from "@orpc/contract"

import {
	PushMetricsRangeInputSchema,
	PushMetricsSchema,
	PushReceiptInputSchema,
	PushReceiptOutputSchema,
	PushSubscribeInputSchema,
	PushSubscriptionStatusSchema,
	SendPushNotificationInputSchema,
	SendPushNotificationOutputSchema,
} from "./push.schema.js"

/** SA-5. What a registered person does with their own subscription. */
export const pisoCampPushContract = {
	status: oc
		.route({
			method: "GET",
			path: "/pisocamp/me/push",
			summary: "Whether this account is opted in to push",
			tags: ["Piso CAMP Push"],
		})
		.output(PushSubscriptionStatusSchema),
	subscribe: oc
		.route({
			method: "POST",
			path: "/pisocamp/me/push",
			summary: "Opt in to push notifications",
			tags: ["Piso CAMP Push"],
		})
		.input(PushSubscribeInputSchema)
		.output(PushSubscriptionStatusSchema),
	unsubscribe: oc
		.route({
			method: "DELETE",
			path: "/pisocamp/me/push",
			summary: "Opt out, removing the stored subscription",
			tags: ["Piso CAMP Push"],
		})
		.output(PushSubscriptionStatusSchema),
	receipt: oc
		.route({
			method: "POST",
			path: "/pisocamp/me/push/receipt",
			summary: "Report that a notification arrived, was opened or was tapped",
			tags: ["Piso CAMP Push"],
		})
		.input(PushReceiptInputSchema)
		.output(PushReceiptOutputSchema),
}

/** SA-5's administrative half. */
export const pisoCampNotificationContract = {
	send: oc
		.route({
			method: "POST",
			path: "/admin/pisocamp/notifications",
			summary: "Send an approved notification to every opted-in account",
			tags: ["Piso CAMP Push"],
		})
		.input(SendPushNotificationInputSchema)
		.output(SendPushNotificationOutputSchema),
	metrics: oc
		.route({
			method: "GET",
			path: "/admin/pisocamp/analytics/notifications",
			summary: "Opt-in, delivery, open, click and re-engagement rates",
			tags: ["Piso CAMP Push"],
		})
		.input(PushMetricsRangeInputSchema)
		.output(PushMetricsSchema),
}
