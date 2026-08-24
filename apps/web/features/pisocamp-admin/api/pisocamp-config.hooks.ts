"use client"

import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query"

import type { PisoCampAdminConfig, UpdatePisoCampAdminConfig } from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function usePisoCampAdminConfigQuery() {
	const options = orpc.pisocamp.admin.config.get.queryOptions({
		networkMode: "online",
		staleTime: 0,
	})

	// The workspace currently resolves two patch lines of TanStack Query through
	// oRPC and React Query. Their runtime option shapes are identical; the cast
	// bridges nominal private QueryClient fields until the catalog is aligned.
	return useQuery<PisoCampAdminConfig, Error>(
		options as unknown as UseQueryOptions<PisoCampAdminConfig, Error>
	)
}

export function useUpdatePisoCampAdminConfigMutation() {
	const queryClient = useQueryClient()

	const options = orpc.pisocamp.admin.config.update.mutationOptions({
		networkMode: "online",
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})

	return useMutation<PisoCampAdminConfig, Error, UpdatePisoCampAdminConfig>(
		options as unknown as UseMutationOptions<PisoCampAdminConfig, Error, UpdatePisoCampAdminConfig>
	)
}
