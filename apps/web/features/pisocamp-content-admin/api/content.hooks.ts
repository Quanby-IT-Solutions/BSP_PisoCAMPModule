"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	CreatePisoCampContentInput,
	ListPisoCampContentInput,
	ListPisoCampContentOutput,
	PisoCampContentDetail,
	UpdatePisoCampContentInput,
} from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"

export function usePisoCampContentListQuery(input: ListPisoCampContentInput) {
	return useQuery<ListPisoCampContentOutput, Error>({
		queryKey: orpc.pisocamp.admin.content.list.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.list(input, { signal }),
		networkMode: "online",
		staleTime: 0,
	})
}

export function usePisoCampContentDetailQuery(
	input: Pick<UpdatePisoCampContentInput, "itemId">,
	enabled = true
) {
	return useQuery<PisoCampContentDetail, Error>({
		queryKey: orpc.pisocamp.admin.content.get.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.get(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
	})
}

export function useCreatePisoCampContentMutation() {
	const queryClient = useQueryClient()

	return useMutation<PisoCampContentDetail, Error, CreatePisoCampContentInput>({
		mutationKey: orpc.pisocamp.admin.content.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.content.create(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.admin.content.key() })
		},
	})
}

export function useUpdatePisoCampContentMutation() {
	const queryClient = useQueryClient()

	return useMutation<PisoCampContentDetail, Error, UpdatePisoCampContentInput>({
		mutationKey: orpc.pisocamp.admin.content.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.content.update(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.admin.content.key() })
		},
	})
}
