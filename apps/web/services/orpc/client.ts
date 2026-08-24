"use client"

import { createORPCClient } from "@orpc/client"
import type { ContractRouterClient } from "@orpc/contract"
import { OpenAPILink } from "@orpc/openapi-client/fetch"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"

import { v1Contract } from "@repo/contracts"

import { env } from "@/env"

export const ORPC_API_URL = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "")

export function credentialedFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
	request: typeof fetch = fetch
) {
	return request(input, { ...init, credentials: "include" })
}

const link = new OpenAPILink(v1Contract, {
	url: ORPC_API_URL,
	fetch: (input, init) => credentialedFetch(input, init),
})

const client: ContractRouterClient<typeof v1Contract> = createORPCClient(link)

export const orpc = createTanstackQueryUtils(client, { path: ["orpc"] })
