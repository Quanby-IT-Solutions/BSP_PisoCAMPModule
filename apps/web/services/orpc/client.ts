"use client"

import { createORPCClient } from "@orpc/client"
import type { ContractRouterClient } from "@orpc/contract"
import { OpenAPILink } from "@orpc/openapi-client/fetch"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"

import { v1Contract } from "@repo/contracts"

import { env } from "@/env"

export const ORPC_API_URL = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "")

export interface OrpcClientContext {
	headers?: Record<string, string>
}

export function credentialedFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
	request: typeof fetch = fetch
) {
	return request(input, { ...init, credentials: "include" })
}

const link = new OpenAPILink<OrpcClientContext>(v1Contract, {
	url: ORPC_API_URL,
	headers: options => options.context.headers ?? {},
	fetch: (input, init) => credentialedFetch(input, init),
})

export const contractClient: ContractRouterClient<typeof v1Contract, OrpcClientContext> =
	createORPCClient(link)

export const orpc = createTanstackQueryUtils(contractClient, { path: ["orpc"] })
