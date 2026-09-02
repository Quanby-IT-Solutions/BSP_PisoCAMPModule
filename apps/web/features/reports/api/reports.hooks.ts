"use client"

import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query"

import type { GenerateReportInput, ReportDefinition, ReportRun } from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function useReportDefinitionsQuery() {
	const options = orpc.pisocamp.admin.reports.definitions.queryOptions({
		networkMode: "online",
		staleTime: 300_000,
	})

	// oRPC and React Query currently resolve nominally distinct QueryClient
	// declarations in this workspace. Their runtime option shapes are identical.
	return useQuery<{ definitions: ReportDefinition[] }, Error>(
		options as unknown as UseQueryOptions<{ definitions: ReportDefinition[] }, Error>
	)
}

export function useReportRunsQuery() {
	const options = orpc.pisocamp.admin.reports.runs.queryOptions({
		input: { limit: 20 },
		networkMode: "online",
		staleTime: 0,
	})

	return useQuery<{ runs: ReportRun[] }, Error>(
		options as unknown as UseQueryOptions<{ runs: ReportRun[] }, Error>
	)
}

export function useGenerateReportMutation() {
	const queryClient = useQueryClient()

	const options = orpc.pisocamp.admin.reports.generate.mutationOptions({
		networkMode: "online",
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.key() })
		},
	})

	return useMutation<ReportRun, Error, GenerateReportInput>(
		options as unknown as UseMutationOptions<ReportRun, Error, GenerateReportInput>
	)
}
