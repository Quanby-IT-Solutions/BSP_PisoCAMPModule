"use client"

import { useQuery, type UseQueryOptions } from "@tanstack/react-query"

import type { ListAuditLogRequest, ListAuditLogResponse } from "@repo/contracts"

import { orpc } from "@/services/orpc/client"

export function usePisoCampAuditQuery(input: ListAuditLogRequest) {
	const options = orpc.pisocamp.admin.audit.list.queryOptions({
		input,
		networkMode: "online",
		// The trail is what somebody is checking right now; a cached page would
		// answer a question they did not ask.
		staleTime: 0,
	})

	// oRPC and React Query currently resolve nominally distinct QueryClient
	// declarations in this workspace. Their runtime option shapes are identical.
	return useQuery<ListAuditLogResponse, Error>(
		options as unknown as UseQueryOptions<ListAuditLogResponse, Error>
	)
}
