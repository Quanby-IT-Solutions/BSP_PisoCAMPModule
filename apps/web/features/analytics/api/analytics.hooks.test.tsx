import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ModuleEntryToday } from "@repo/contracts"

import { useModuleEntryTodayQuery } from "./analytics.hooks"

const { fetchModuleEntryToday, queryOptions } = vi.hoisted(() => ({
	fetchModuleEntryToday: vi.fn(),
	queryOptions: vi.fn((options: Record<string, unknown>) => ({
		queryKey: [["orpc", "pisocamp", "analytics", "moduleEntryToday"]],
		queryFn: () => fetchModuleEntryToday(),
		...options,
	})),
}))

vi.mock("@/services/orpc/client", () => ({
	orpc: {
		pisocamp: {
			analytics: {
				moduleEntryToday: { queryOptions },
			},
		},
	},
}))

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: PropsWithChildren) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	}
}

function createQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe("useModuleEntryTodayQuery", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not request the protected summary when disabled", async () => {
		const queryClient = createQueryClient()

		const { result } = renderHook(() => useModuleEntryTodayQuery({ enabled: false }), {
			wrapper: createWrapper(queryClient),
		})

		expect(result.current.fetchStatus).toBe("idle")
		expect(fetchModuleEntryToday).not.toHaveBeenCalled()
		expect(queryOptions).toHaveBeenCalledWith({
			enabled: false,
			networkMode: "online",
			staleTime: 60_000,
		})
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(fetchModuleEntryToday).not.toHaveBeenCalled()
	})

	it("returns the contract-typed summary through an online one-minute query", async () => {
		const summary: ModuleEntryToday = {
			moduleEntryCount: 12_345,
			date: "2026-08-31",
			timezone: "Asia/Manila",
		}
		fetchModuleEntryToday.mockResolvedValue(summary)
		const queryClient = createQueryClient()

		const { result } = renderHook(() => useModuleEntryTodayQuery({ enabled: true }), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(result.current.data).toEqual(summary)
		expect(fetchModuleEntryToday).toHaveBeenCalledOnce()
		expect(queryOptions).toHaveBeenCalledWith({
			enabled: true,
			networkMode: "online",
			staleTime: 60_000,
		})
		const cachedOptions = queryClient.getQueryCache().getAll()[0]?.options as
			| { networkMode?: string; staleTime?: number }
			| undefined
		expect(cachedOptions?.networkMode).toBe("online")
		expect(cachedOptions?.staleTime).toBe(60_000)
	})

	it("represents request failures as query state", async () => {
		fetchModuleEntryToday.mockRejectedValue(new Error("private upstream response body"))
		const queryClient = createQueryClient()

		const { result } = renderHook(() => useModuleEntryTodayQuery({ enabled: true }), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => expect(result.current.isError).toBe(true))
		expect(result.current.error).toBeInstanceOf(Error)
	})
})
