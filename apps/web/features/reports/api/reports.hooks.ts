"use client"

import {
	useMutation,
	useQuery,
	useQueryClient,
	type UseMutationOptions,
	type UseQueryOptions,
} from "@tanstack/react-query"

import type { GenerateReportInput, ReportDefinition, ReportRun } from "@repo/contracts"

import { env } from "@/env"
import { orpc } from "@/services/orpc/client"

/**
 * Where a generated report is downloaded from, per format.
 *
 * A plain URL rather than a fetch: the body is a file, and letting the browser
 * save it directly keeps the whole thing out of memory and gives the person the
 * ordinary download they expect.
 */
export function reportExportUrl(runId: string, format: "xlsx" | "docx" | "pdf"): string {
	const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, "")
	return `${base}/${env.NEXT_PUBLIC_API_VERSION}/admin/pisocamp/reports/runs/${encodeURIComponent(
		runId
	)}/export/${format}`
}

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
