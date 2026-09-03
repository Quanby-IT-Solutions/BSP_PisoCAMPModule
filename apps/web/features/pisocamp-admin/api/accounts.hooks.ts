"use client"

import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query"

import type {
	DeletePisoCampSubjectDataInput,
	DeletePisoCampSubjectDataOutput,
	ListPisoCampAccountsInput,
	ListPisoCampAccountsOutput,
	ListPisoCampRolesOutput,
	PisoCampAccount,
	SetPisoCampAccountStatusInput,
	SetPisoCampUserRolesInput,
	SetPisoCampUserRolesOutput,
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

export function usePisoCampRolesQuery() {
	const options = orpc.pisocamp.admin.roles.list.queryOptions({
		networkMode: "online",
		// The role catalogue changes far less often than who holds what.
		staleTime: 300_000,
	})

	return useQuery<ListPisoCampRolesOutput, Error>(
		options as unknown as UseQueryOptions<ListPisoCampRolesOutput, Error>
	)
}

export function useSetPisoCampUserRolesMutation() {
	const queryClient = useQueryClient()

	const options = orpc.pisocamp.admin.roles.setUserRoles.mutationOptions({
		networkMode: "online",
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})

	return useMutation<SetPisoCampUserRolesOutput, Error, SetPisoCampUserRolesInput>(
		options as unknown as UseMutationOptions<
			SetPisoCampUserRolesOutput,
			Error,
			SetPisoCampUserRolesInput
		>
	)
}

export function useDeletePisoCampSubjectDataMutation() {
	const queryClient = useQueryClient()

	const options = orpc.pisocamp.admin.dataSubject.delete.mutationOptions({
		networkMode: "online",
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})

	return useMutation<
		DeletePisoCampSubjectDataOutput,
		Error,
		DeletePisoCampSubjectDataInput
	>(
		options as unknown as UseMutationOptions<
			DeletePisoCampSubjectDataOutput,
			Error,
			DeletePisoCampSubjectDataInput
		>
	)
}
