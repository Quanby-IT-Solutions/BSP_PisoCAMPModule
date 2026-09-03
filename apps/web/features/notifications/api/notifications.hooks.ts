"use client"

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query"

import type {
	EngagementRangeInput,
	PushMetrics,
	SendPushNotificationInput,
	SendPushNotificationOutput,
} from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function useNotificationMetricsQuery(input: EngagementRangeInput) {
	const options = orpc.pisocamp.admin.notifications.metrics.queryOptions({
		input,
		networkMode: "online",
		staleTime: 30_000,
	})

	return useQuery<PushMetrics, Error>(
		options as unknown as UseQueryOptions<PushMetrics, Error>
	)
}

/**
 * SA-5's send.
 *
 * Invalidates the metrics on success, because the notification somebody just
 * sent belongs in the table under the form they sent it from.
 */
export function useSendNotificationMutation() {
	const queryClient = useQueryClient()

	return useMutation<SendPushNotificationOutput, Error, SendPushNotificationInput>({
		mutationFn: input =>
			orpc.pisocamp.admin.notifications.send.call(
				input
			) as unknown as Promise<SendPushNotificationOutput>,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: orpc.pisocamp.admin.notifications.metrics.key(),
			}),
	})
}
