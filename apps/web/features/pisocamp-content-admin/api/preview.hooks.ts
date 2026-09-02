"use client"

import { useQuery } from "@tanstack/react-query"

import type { GetPisoCampContentPreviewInput, PisoCampContentPreviewGrant } from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"
import { env } from "@/env"

/**
 * Fetch a short-lived preview grant.
 *
 * `staleTime: 0` plus `gcTime: 0` keeps the grant out of the client cache: it
 * is a bearer credential for unpublished content and it must never be reused
 * from a cache after the version moves on.
 */
export function usePisoCampContentPreviewQuery(
	input: GetPisoCampContentPreviewInput,
	enabled = true
) {
	return useQuery<PisoCampContentPreviewGrant, Error>({
		queryKey: orpc.pisocamp.admin.preview.create.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.preview.create(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
	})
}

/** Absolute URL for one preview attachment, authorised by the grant. */
export function pisoCampPreviewAssetUrl(assetId: string, token: string): string {
	const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, "")
	return `${base}/${env.NEXT_PUBLIC_API_VERSION}/pisocamp/preview/resources/${encodeURIComponent(
		assetId
	)}?token=${encodeURIComponent(token)}`
}

/** The URL encoded into the scannable preview code the mobile preview build reads. */
export function pisoCampPreviewRedeemUrl(token: string): string {
	const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, "")
	return `${base}/${env.NEXT_PUBLIC_API_VERSION}/pisocamp/preview?token=${encodeURIComponent(token)}`
}
