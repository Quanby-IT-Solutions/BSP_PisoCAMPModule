"use client"

import { useQuery } from "@tanstack/react-query"

import type { ListPisoCampContentAuditInput, ListPisoCampContentAuditOutput } from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"

export function usePisoCampContentAuditQuery(input: ListPisoCampContentAuditInput, enabled = true) {
	return useQuery<ListPisoCampContentAuditOutput, Error>({
		queryKey: orpc.pisocamp.admin.content.audit.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.audit(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
		placeholderData: previous => previous,
	})
}
