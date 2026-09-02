"use client"

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"

import type {
	AttachPisoCampAssetInput,
	DeletePisoCampAssetInput,
	DetachPisoCampAssetInput,
	ListPisoCampAssetsOutput,
	PisoCampAssetMutationOutput,
	UploadPisoCampAssetInput,
} from "@repo/contracts"

import { contractClient, orpc } from "@/services/orpc/client"

type AssetListInput = { itemId: string }

async function invalidateAssetAndContentQueries(queryClient: QueryClient, itemId: string) {
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: orpc.pisocamp.admin.assets.list.queryKey({ input: { itemId } }),
		}),
		queryClient.invalidateQueries({
			queryKey: orpc.pisocamp.admin.content.get.queryKey({ input: { itemId } }),
		}),
	])
}

export function usePisoCampAssetsQuery(input: AssetListInput, enabled = true) {
	return useQuery<ListPisoCampAssetsOutput, Error>({
		queryKey: orpc.pisocamp.admin.assets.list.queryKey({ input }),
		queryFn: ({ signal }) => contractClient.pisocamp.admin.assets.list(input, { signal }),
		enabled,
		networkMode: "online",
		staleTime: 0,
	})
}

function useAssetMutation<TInput extends { itemId: string; requestId: string }>(
	mutationFn: (input: TInput) => Promise<PisoCampAssetMutationOutput>
) {
	const queryClient = useQueryClient()
	return useMutation<PisoCampAssetMutationOutput, Error, TInput>({
		networkMode: "online",
		mutationFn,
		onSuccess: result => invalidateAssetAndContentQueries(queryClient, result.asset.contentItemId),
	})
}

export function useUploadPisoCampAssetMutation() {
	return useAssetMutation((input: UploadPisoCampAssetInput) =>
		contractClient.pisocamp.admin.assets.upload(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useAttachPisoCampAssetMutation() {
	return useAssetMutation((input: AttachPisoCampAssetInput) =>
		contractClient.pisocamp.admin.assets.attach(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useDetachPisoCampAssetMutation() {
	return useAssetMutation((input: DetachPisoCampAssetInput) =>
		contractClient.pisocamp.admin.assets.detach(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}

export function useDeletePisoCampAssetMutation() {
	return useAssetMutation((input: DeletePisoCampAssetInput) =>
		contractClient.pisocamp.admin.assets.delete(input, {
			context: { headers: { "Idempotency-Key": input.requestId } },
		})
	)
}
