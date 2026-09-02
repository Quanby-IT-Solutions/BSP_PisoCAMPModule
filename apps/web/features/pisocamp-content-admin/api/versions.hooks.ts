"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	ListPisoCampContentVersionsInput,
	ListPisoCampContentVersionsOutput,
	PisoCampContentReviewDetail,
	RestorePisoCampContentVersionInput,
} from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"

export function usePisoCampContentVersionsQuery(
	input: ListPisoCampContentVersionsInput,
	enabled = true
) {
	return useQuery<ListPisoCampContentVersionsOutput, Error>({
		queryKey: orpc.pisocamp.admin.content.versions.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.versions(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
	})
}

export function useRestorePisoCampContentVersionMutation() {
	const queryClient = useQueryClient()

	return useMutation<PisoCampContentReviewDetail, Error, RestorePisoCampContentVersionInput>({
		mutationKey: orpc.pisocamp.admin.content.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.content.restore(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.admin.content.key() })
		},
	})
}
