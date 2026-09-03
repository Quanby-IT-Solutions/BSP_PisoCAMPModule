"use client"

import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query"

import type {
	ListPisoCampAccountsInput,
	ListPisoCampAccountsOutput,
	PisoCampAccount,
	SetPisoCampAccountStatusInput,
} from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function usePisoCampAccountsQuery(input: ListPisoCampAccountsInput) {
	const options = orpc.pisocamp.admin.accounts.list.queryOptions({
		input,
		networkMode: "online",
		// A status change has to be visible immediately: somebody is checking
		// whether the person they just locked out is actually locked out.
		staleTime: 0,
	})

	// oRPC and React Query currently resolve nominally distinct QueryClient
	// declarations in this workspace. Their runtime option shapes are identical.
	return useQuery<ListPisoCampAccountsOutput, Error>(
		options as unknown as UseQueryOptions<ListPisoCampAccountsOutput, Error>
	)
}

export function useSetPisoCampAccountStatusMutation() {
	const queryClient = useQueryClient()

	const options = orpc.pisocamp.admin.accounts.setStatus.mutationOptions({
		networkMode: "online",
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})

	return useMutation<PisoCampAccount, Error, SetPisoCampAccountStatusInput>(
		options as unknown as UseMutationOptions<
			PisoCampAccount,
			Error,
			SetPisoCampAccountStatusInput
		>
	)
}
