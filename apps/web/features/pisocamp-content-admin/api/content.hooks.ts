"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	ApprovePisoCampContentInput,
	ArchivePisoCampContentInput,
	CreatePisoCampContentInput,
	DeactivatePisoCampContentInput,
	ListPisoCampContentInput,
	ListPisoCampContentOutput,
	ListPisoCampContentReviewQueueInput,
	ListPisoCampContentReviewQueueOutput,
	PisoCampContentDetail,
	PisoCampContentReviewDetail,
	PublishPisoCampContentInput,
	RejectPisoCampContentInput,
	SchedulePisoCampContentPublicationInput,
	SubmitPisoCampContentInput,
	UnpublishPisoCampContentInput,
	UpdatePisoCampContentInput,
} from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"

export function usePisoCampContentListQuery(input: ListPisoCampContentInput) {
	return useQuery<ListPisoCampContentOutput, Error>({
		queryKey: orpc.pisocamp.admin.content.list.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.list(input, { signal }),
		networkMode: "online",
		staleTime: 0,
	})
}

export function usePisoCampContentDetailQuery(
	input: Pick<UpdatePisoCampContentInput, "itemId">,
	enabled = true
) {
	return useQuery<PisoCampContentDetail, Error>({
		queryKey: orpc.pisocamp.admin.content.get.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.get(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
	})
}

export function usePisoCampContentReviewQueueQuery(input: ListPisoCampContentReviewQueueInput) {
	return useQuery<ListPisoCampContentReviewQueueOutput, Error>({
		queryKey: orpc.pisocamp.admin.content.reviewQueue.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.reviewQueue(input, { signal }),
		networkMode: "online",
		staleTime: 0,
	})
}

export function usePisoCampContentReviewDetailQuery(
	input: Pick<SubmitPisoCampContentInput, "itemId">,
	enabled = true
) {
	return useQuery<PisoCampContentReviewDetail, Error>({
		queryKey: orpc.pisocamp.admin.content.review.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.content.review(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
	})
}

export function useCreatePisoCampContentMutation() {
	const queryClient = useQueryClient()

	return useMutation<PisoCampContentDetail, Error, CreatePisoCampContentInput>({
		mutationKey: orpc.pisocamp.admin.content.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.content.create(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.admin.content.key() })
		},
	})
}

export function useUpdatePisoCampContentMutation() {
	const queryClient = useQueryClient()

	return useMutation<PisoCampContentDetail, Error, UpdatePisoCampContentInput>({
		mutationKey: orpc.pisocamp.admin.content.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn: input =>
			contractClient.pisocamp.admin.content.update(input, {
				context: { headers: { "Idempotency-Key": input.requestId } },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.admin.content.key() })
		},
	})
}

function useContentTransitionMutation<TInput extends { requestId: string }>(
	mutationFn: (input: TInput) => Promise<PisoCampContentReviewDetail>
) {
	const queryClient = useQueryClient()

	return useMutation<PisoCampContentReviewDetail, Error, TInput>({
		mutationKey: orpc.pisocamp.admin.content.key({ type: "mutation" }),
		networkMode: "online",
		mutationFn,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: orpc.pisocamp.admin.content.key() })
		},
	})
}

export function useSubmitPisoCampContentMutation() {
	return useContentTransitionMutation((input: SubmitPisoCampContentInput) =>
		contractClient.pisocamp.admin.content.submit(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useApprovePisoCampContentMutation() {
	return useContentTransitionMutation((input: ApprovePisoCampContentInput) =>
		contractClient.pisocamp.admin.content.approve(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useRejectPisoCampContentMutation() {
	return useContentTransitionMutation((input: RejectPisoCampContentInput) =>
		contractClient.pisocamp.admin.content.reject(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function usePublishPisoCampContentMutation() {
	return useContentTransitionMutation((input: PublishPisoCampContentInput) =>
		contractClient.pisocamp.admin.content.publish(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useUnpublishPisoCampContentMutation() {
	return useContentTransitionMutation((input: UnpublishPisoCampContentInput) =>
		contractClient.pisocamp.admin.content.unpublish(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useDeactivatePisoCampContentMutation() {
	return useContentTransitionMutation((input: DeactivatePisoCampContentInput) =>
		contractClient.pisocamp.admin.content.deactivate(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useArchivePisoCampContentMutation() {
	return useContentTransitionMutation((input: ArchivePisoCampContentInput) =>
		contractClient.pisocamp.admin.content.archive(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useSchedulePisoCampContentPublicationMutation() {
	return useContentTransitionMutation((input: SchedulePisoCampContentPublicationInput) =>
		contractClient.pisocamp.admin.content.schedule(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}
