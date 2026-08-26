import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
	CreatePisoCampContentInput,
	ListPisoCampContentInput,
	UpdatePisoCampContentInput,
} from "@repo/contracts"

import {
	useCreatePisoCampContentMutation,
	usePisoCampContentDetailQuery,
	usePisoCampContentListQuery,
	useUpdatePisoCampContentMutation,
} from "./content.hooks"

const {
	createContent,
	updateContent,
	listContent,
	getContent,
	contentKey,
	listQueryKey,
	getQueryKey,
} = vi.hoisted(() => ({
	createContent: vi.fn(),
	updateContent: vi.fn(),
	listContent: vi.fn(),
	getContent: vi.fn(),
	contentKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content"]]),
	listQueryKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content", "list"]]),
	getQueryKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content", "get"]]),
}))

vi.mock("@/services/orpc/client", () => ({
	contractClient: {
		pisocamp: {
			admin: {
				content: {
					create: createContent,
					update: updateContent,
					list: listContent,
					get: getContent,
				},
			},
		},
	},
	orpc: {
		pisocamp: {
			admin: {
				content: {
					key: contentKey,
					list: { queryKey: listQueryKey },
					get: { queryKey: getQueryKey },
				},
			},
		},
	},
}))

const createInput: CreatePisoCampContentInput = {
	requestId: "d7ef42f1-5a30-4fa7-9da5-c3af0d0bbb36",
	content: {
		contentType: "advisory",
		title: "Counterfeit advisory",
		summary: "How to identify suspect notes.",
		body: "Bring suspect notes to an authorized bank.",
	},
	relatedLinks: [],
}

const updateInput: UpdatePisoCampContentInput = {
	...createInput,
	itemId: "38fd44f4-ebde-49b1-86e0-b6711ccf6756",
	expectedVersionNo: 1,
}

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: PropsWithChildren) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	}
}

describe("Piso CAMP content authoring hooks", () => {
	beforeEach(() => vi.clearAllMocks())

	it("uses typed clients and oRPC keys for online-only list and detail reads", async () => {
		const queryClient = new QueryClient()
		const wrapper = createWrapper(queryClient)
		const listInput: ListPisoCampContentInput = { page: 1, limit: 20 }
		listContent.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 })
		getContent.mockResolvedValue({ id: updateInput.itemId })

		renderHook(() => usePisoCampContentListQuery(listInput), { wrapper })
		renderHook(() => usePisoCampContentDetailQuery({ itemId: updateInput.itemId }), { wrapper })

		expect(listQueryKey).toHaveBeenCalledWith({ input: listInput })
		expect(getQueryKey).toHaveBeenCalledWith({ input: { itemId: updateInput.itemId } })
		await waitFor(() => expect(listContent).toHaveBeenCalledWith(listInput, expect.any(Object)))
		await waitFor(() =>
			expect(getContent).toHaveBeenCalledWith({ itemId: updateInput.itemId }, expect.any(Object))
		)
		expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
		expect(
			queryClient
				.getQueryCache()
				.getAll()
				.every(query => query.options.networkMode === "online")
		).toBe(true)
	})

	it.each([
		["create", useCreatePisoCampContentMutation, createContent, createInput],
		["update", useUpdatePisoCampContentMutation, updateContent, updateInput],
	] as const)(
		"reuses the %s request id and idempotency header across retries, then invalidates content",
		async (_label, useContentMutation, clientMutation, input) => {
			clientMutation
				.mockRejectedValueOnce(new Error("temporary network failure"))
				.mockResolvedValue({ id: "saved" })
			const queryClient = new QueryClient({
				defaultOptions: { mutations: { retry: 1, retryDelay: 0 } },
			})
			const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue()
			const { result } = renderHook(() => useContentMutation(), {
				wrapper: createWrapper(queryClient),
			})

			await act(async () => {
				await result.current.mutateAsync(input as never)
			})

			expect(clientMutation).toHaveBeenCalledTimes(2)
			for (const [attemptInput, attemptOptions] of clientMutation.mock.calls) {
				expect(attemptInput).toBe(input)
				expect(attemptInput.requestId).toBe(input.requestId)
				expect(attemptOptions).toEqual({
					context: { headers: { "Idempotency-Key": input.requestId } },
				})
			}
			expect(contentKey).toHaveBeenCalled()
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: [["orpc", "pisocamp", "admin", "content"]],
			})
			await waitFor(() =>
				expect(queryClient.getMutationCache().getAll()[0]?.options.networkMode).toBe("online")
			)
		}
	)
})
