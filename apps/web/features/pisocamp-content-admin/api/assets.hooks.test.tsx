import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
	AttachPisoCampAssetInput,
	DeletePisoCampAssetInput,
	DetachPisoCampAssetInput,
	PisoCampAssetMutationOutput,
	UploadPisoCampAssetInput,
} from "@repo/contracts"

import {
	useAttachPisoCampAssetMutation,
	useDeletePisoCampAssetMutation,
	useDetachPisoCampAssetMutation,
	usePisoCampAssetsQuery,
	useUploadPisoCampAssetMutation,
} from "./assets.hooks"

const {
	listAssets,
	uploadAsset,
	attachAsset,
	detachAsset,
	deleteAsset,
	assetListQueryKey,
	contentDetailQueryKey,
} = vi.hoisted(() => ({
	listAssets: vi.fn(),
	uploadAsset: vi.fn(),
	attachAsset: vi.fn(),
	detachAsset: vi.fn(),
	deleteAsset: vi.fn(),
	assetListQueryKey: vi.fn(({ input }) => ["assets", input.itemId]),
	contentDetailQueryKey: vi.fn(({ input }) => ["content", input.itemId]),
}))

vi.mock("@/services/orpc/client", () => ({
	contractClient: {
		pisocamp: {
			admin: {
				assets: {
					list: listAssets,
					upload: uploadAsset,
					attach: attachAsset,
					detach: detachAsset,
					delete: deleteAsset,
				},
			},
		},
	},
	orpc: {
		pisocamp: {
			admin: {
				assets: { list: { queryKey: assetListQueryKey } },
				content: { get: { queryKey: contentDetailQueryKey } },
			},
		},
	},
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const assetId = "96e7ab09-0d06-4d75-9675-510fa43bd56b"
const requestId = "d7ef42f1-5a30-4fa7-9da5-c3af0d0bbb36"
const output: PisoCampAssetMutationOutput = {
	asset: {
		id: assetId,
		contentItemId: itemId,
		sha256: "a".repeat(64),
		mediaType: "image/png",
		byteLength: 67,
		version: 1,
		createdAt: "2026-09-01T00:00:00.000Z",
	},
	currentVersionId: "f507f4c6-f3e1-48fe-9e23-bf53731ee99b",
	currentVersionNo: 2,
	attachments: [],
}

const uploadInput: UploadPisoCampAssetInput = {
	file: new File([new Uint8Array([137, 80, 78, 71])], "obverse.png", { type: "image/png" }),
	itemId,
	expectedVersionNo: 1,
	role: "obverse",
	requestId,
}
const attachInput: AttachPisoCampAssetInput = {
	assetId,
	itemId,
	expectedVersionNo: 1,
	role: "obverse",
	requestId,
}
const detachInput: DetachPisoCampAssetInput = { ...attachInput }
const deleteInput: DeletePisoCampAssetInput = {
	assetId,
	itemId,
	expectedVersionNo: 1,
	requestId,
}

function wrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: PropsWithChildren) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	}
}

describe("Piso CAMP asset hooks", () => {
	beforeEach(() => vi.clearAllMocks())

	it("uses the item-scoped typed list contract with an abortable online query", async () => {
		const queryClient = new QueryClient()
		listAssets.mockReturnValue(new Promise(() => undefined))

		renderHook(() => usePisoCampAssetsQuery({ itemId }), { wrapper: wrapper(queryClient) })

		expect(assetListQueryKey).toHaveBeenCalledWith({ input: { itemId } })
		await waitFor(() => expect(listAssets).toHaveBeenCalledOnce())
		const signal = listAssets.mock.calls[0]?.[1]?.signal
		expect(listAssets).toHaveBeenCalledWith({ itemId }, { signal })
		expect(signal).toBeInstanceOf(AbortSignal)
		expect(queryClient.getQueryCache().getAll()[0]?.options.networkMode).toBe("online")
		await queryClient.cancelQueries()
		expect(signal.aborted).toBe(true)
	})

	it("sends the selected File and exact request id as the upload idempotency header", async () => {
		uploadAsset.mockResolvedValue(output)
		const queryClient = new QueryClient()
		const { result } = renderHook(() => useUploadPisoCampAssetMutation(), {
			wrapper: wrapper(queryClient),
		})

		await act(async () => result.current.mutateAsync(uploadInput))

		expect(uploadAsset).toHaveBeenCalledWith(uploadInput, {
			context: { headers: { "Idempotency-Key": requestId } },
		})
		expect(uploadAsset.mock.calls[0]?.[0].file).toBe(uploadInput.file)
	})

	it.each([
		["upload", useUploadPisoCampAssetMutation, uploadAsset, uploadInput],
		["attach", useAttachPisoCampAssetMutation, attachAsset, attachInput],
		["detach", useDetachPisoCampAssetMutation, detachAsset, detachInput],
		["delete", useDeletePisoCampAssetMutation, deleteAsset, deleteInput],
	] as const)(
		"invalidates only the affected item asset list and content detail after %s succeeds",
		async (_label, useAssetMutation, clientMutation, input) => {
			clientMutation.mockResolvedValue(output)
			const queryClient = new QueryClient()
			const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue()
			const { result } = renderHook(() => useAssetMutation(), {
				wrapper: wrapper(queryClient),
			})

			await act(async () => result.current.mutateAsync(input as never))

			expect(invalidate).toHaveBeenNthCalledWith(1, { queryKey: ["assets", itemId] })
			expect(invalidate).toHaveBeenNthCalledWith(2, { queryKey: ["content", itemId] })
			expect(invalidate).toHaveBeenCalledTimes(2)
		}
	)

	it("keeps a safe server conflict observable to the component", async () => {
		const conflict = { status: 409, code: "CONFLICT" }
		attachAsset.mockRejectedValue(conflict)
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
		const { result } = renderHook(() => useAttachPisoCampAssetMutation(), {
			wrapper: wrapper(queryClient),
		})

		await act(async () => {
			await expect(result.current.mutateAsync(attachInput)).rejects.toBe(conflict)
		})

		expect(result.current.isError).toBe(true)
		expect(result.current.error).toBe(conflict)
	})
})
