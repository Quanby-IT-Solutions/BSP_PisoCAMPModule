import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
	ApprovePisoCampContentInput,
	CreatePisoCampContentInput,
	ListPisoCampContentInput,
	ListPisoCampContentReviewQueueInput,
	PublishPisoCampContentInput,
	RejectPisoCampContentInput,
	SubmitPisoCampContentInput,
	UpdatePisoCampContentInput,
} from "@repo/contracts"

import { shouldDehydrateMutation } from "@/services/tanstack-query/query-client"

import {
	useApprovePisoCampContentMutation,
	useCreatePisoCampContentMutation,
	usePisoCampContentDetailQuery,
	usePisoCampContentListQuery,
	usePisoCampContentReviewDetailQuery,
	usePisoCampContentReviewQueueQuery,
	usePublishPisoCampContentMutation,
	useRejectPisoCampContentMutation,
	useSubmitPisoCampContentMutation,
	useUpdatePisoCampContentMutation,
} from "./content.hooks"

const {
	createContent,
	updateContent,
	listContent,
	getContent,
	reviewQueueContent,
	reviewContent,
	submitContent,
	approveContent,
	rejectContent,
	publishContent,
	contentKey,
	listQueryKey,
	getQueryKey,
	reviewQueueQueryKey,
	reviewQueryKey,
} = vi.hoisted(() => ({
	createContent: vi.fn(),
	updateContent: vi.fn(),
	listContent: vi.fn(),
	getContent: vi.fn(),
	reviewQueueContent: vi.fn(),
	reviewContent: vi.fn(),
	submitContent: vi.fn(),
	approveContent: vi.fn(),
	rejectContent: vi.fn(),
	publishContent: vi.fn(),
	contentKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content"]]),
	listQueryKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content", "list"]]),
	getQueryKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content", "get"]]),
	reviewQueueQueryKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content", "reviewQueue"]]),
	reviewQueryKey: vi.fn(() => [["orpc", "pisocamp", "admin", "content", "review"]]),
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
					reviewQueue: reviewQueueContent,
					review: reviewContent,
					submit: submitContent,
					approve: approveContent,
					reject: rejectContent,
					publish: publishContent,
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
					reviewQueue: { queryKey: reviewQueueQueryKey },
					review: { queryKey: reviewQueryKey },
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

const transitionCorrelation = {
	itemId: updateInput.itemId,
	requestId: "1e09e3da-5dc4-48ca-9978-782f4ca93a48",
	expectedVersionNo: 2,
}

const submitInput: SubmitPisoCampContentInput = transitionCorrelation
const approveInput: ApprovePisoCampContentInput = {
	...transitionCorrelation,
	comments: "Reviewed against approved source material.",
}
const rejectInput: RejectPisoCampContentInput = {
	...transitionCorrelation,
	comments: "Please revise the summary.",
}
const publishInput: PublishPisoCampContentInput = transitionCorrelation

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
		listContent.mockReturnValue(new Promise(() => undefined))
		getContent.mockReturnValue(new Promise(() => undefined))

		renderHook(() => usePisoCampContentListQuery(listInput), { wrapper })
		renderHook(() => usePisoCampContentDetailQuery({ itemId: updateInput.itemId }), { wrapper })

		expect(listQueryKey).toHaveBeenCalledWith({ input: listInput })
		expect(getQueryKey).toHaveBeenCalledWith({ input: { itemId: updateInput.itemId } })
		await waitFor(() => expect(listContent).toHaveBeenCalledOnce())
		await waitFor(() => expect(getContent).toHaveBeenCalledOnce())
		const listSignal = listContent.mock.calls[0]?.[1]?.signal
		const detailSignal = getContent.mock.calls[0]?.[1]?.signal
		expect(listContent).toHaveBeenCalledWith(listInput, { signal: listSignal })
		expect(getContent).toHaveBeenCalledWith(
			{ itemId: updateInput.itemId },
			{ signal: detailSignal }
		)
		expect(listSignal).toBeInstanceOf(AbortSignal)
		expect(detailSignal).toBeInstanceOf(AbortSignal)
		expect(listSignal?.aborted).toBe(false)
		expect(detailSignal?.aborted).toBe(false)
		expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
		expect(
			queryClient
				.getQueryCache()
				.getAll()
				.every(query => query.options.networkMode === "online")
		).toBe(true)
		await queryClient.cancelQueries()
		expect(listSignal?.aborted).toBe(true)
		expect(detailSignal?.aborted).toBe(true)
	})

	it("uses typed clients and exact oRPC keys for online-only review queue and detail reads", async () => {
		const queryClient = new QueryClient()
		const wrapper = createWrapper(queryClient)
		const queueInput: ListPisoCampContentReviewQueueInput = {
			page: 2,
			limit: 20,
			status: "submitted_for_review",
		}
		reviewQueueContent.mockReturnValue(new Promise(() => undefined))
		reviewContent.mockReturnValue(new Promise(() => undefined))

		renderHook(() => usePisoCampContentReviewQueueQuery(queueInput), { wrapper })
		renderHook(() => usePisoCampContentReviewDetailQuery({ itemId: updateInput.itemId }), {
			wrapper,
		})

		expect(reviewQueueQueryKey).toHaveBeenCalledWith({ input: queueInput })
		expect(reviewQueryKey).toHaveBeenCalledWith({ input: { itemId: updateInput.itemId } })
		await waitFor(() => expect(reviewQueueContent).toHaveBeenCalledOnce())
		await waitFor(() => expect(reviewContent).toHaveBeenCalledOnce())
		const queueSignal = reviewQueueContent.mock.calls[0]?.[1]?.signal
		const reviewSignal = reviewContent.mock.calls[0]?.[1]?.signal
		expect(reviewQueueContent).toHaveBeenCalledWith(queueInput, { signal: queueSignal })
		expect(reviewContent).toHaveBeenCalledWith(
			{ itemId: updateInput.itemId },
			{ signal: reviewSignal }
		)
		expect(queueSignal).toBeInstanceOf(AbortSignal)
		expect(reviewSignal).toBeInstanceOf(AbortSignal)
		expect(queueSignal?.aborted).toBe(false)
		expect(reviewSignal?.aborted).toBe(false)
		expect(
			queryClient
				.getQueryCache()
				.getAll()
				.every(query => query.options.networkMode === "online")
		).toBe(true)
		await queryClient.cancelQueries()
		expect(queueSignal?.aborted).toBe(true)
		expect(reviewSignal?.aborted).toBe(true)
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

	it.each([
		["submit", useSubmitPisoCampContentMutation, submitContent, submitInput],
		["approve", useApprovePisoCampContentMutation, approveContent, approveInput],
		["reject", useRejectPisoCampContentMutation, rejectContent, rejectInput],
		["publish", usePublishPisoCampContentMutation, publishContent, publishInput],
	] as const)(
		"keeps successive %s transitions online-only, forwards each request's idempotency metadata, invalidates content, and excludes the actual mutation key from persistence",
		async (_label, useTransitionMutation, clientMutation, input) => {
			clientMutation.mockResolvedValue({ id: input.itemId })
			const secondInput = {
				...input,
				requestId: "8d580d61-b57e-4c31-a6ec-dbc3fa61a4c9",
			}
			const queryClient = new QueryClient()
			const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue()
			const { result } = renderHook(() => useTransitionMutation(), {
				wrapper: createWrapper(queryClient),
			})

			await act(async () => {
				await result.current.mutateAsync(input as never)
				await result.current.mutateAsync(secondInput as never)
			})

			expect(clientMutation).toHaveBeenNthCalledWith(1, input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			})
			expect(clientMutation).toHaveBeenNthCalledWith(2, secondInput, {
				context: { headers: { "Idempotency-Key": secondInput.requestId } },
			})
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: [["orpc", "pisocamp", "admin", "content"]],
			})
			const cachedMutations = queryClient.getMutationCache().getAll()
			expect(cachedMutations).toHaveLength(2)
			for (const mutation of cachedMutations) {
				expect(mutation.options.networkMode).toBe("online")
				expect(
					shouldDehydrateMutation({
						options: { mutationKey: mutation.options.mutationKey },
						state: { isPaused: true },
					})
				).toBe(false)
			}
		}
	)
})
