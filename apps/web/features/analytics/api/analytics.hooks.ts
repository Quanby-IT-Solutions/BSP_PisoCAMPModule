"use client"

import { useQuery, type UseQueryOptions } from "@tanstack/react-query"

import type { ModuleEntryToday } from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function useModuleEntryTodayQuery({ enabled }: { enabled: boolean }) {
	const options = orpc.pisocamp.analytics.moduleEntryToday.queryOptions({
		enabled,
		networkMode: "online",
		staleTime: 60_000,
	})

	// oRPC and React Query currently resolve nominally distinct QueryClient
	// declarations in this workspace. Their runtime option shapes are identical.
	return useQuery<ModuleEntryToday, Error>(
		options as unknown as UseQueryOptions<ModuleEntryToday, Error>
	)
}
