import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ListPisoCampAssetsOutput, PisoCampAssetMutationOutput } from "@repo/contracts"

import { AssetAttachmentsEditor } from "./asset-attachments-editor"

const { useAssets, useUpload, useAttach, useDetach, useDelete } = vi.hoisted(() => ({
	useAssets: vi.fn(),
	useUpload: vi.fn(),
	useAttach: vi.fn(),
	useDetach: vi.fn(),
	useDelete: vi.fn(),
}))

vi.mock("@/features/pisocamp-content-admin/api/assets.hooks", () => ({
	usePisoCampAssetsQuery: useAssets,
	useUploadPisoCampAssetMutation: useUpload,
	useAttachPisoCampAssetMutation: useAttach,
	useDetachPisoCampAssetMutation: useDetach,
	useDeletePisoCampAssetMutation: useDelete,
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const attachedAssetId = "96e7ab09-0d06-4d75-9675-510fa43bd56b"
const availableAssetId = "bff9f45a-95a5-401d-be09-325cd8a35e7b"
const sha256 = "abcdef0123456789".repeat(4)
const attachment = {
	role: "obverse" as const,
	asset: {
		id: attachedAssetId,
		contentItemId: itemId,
		sha256,
		mediaType: "image/png" as const,
		byteLength: 1_024,
		version: 1,
		createdAt: "2026-09-01T00:00:00.000Z",
	},
}
const available = {
	id: availableAssetId,
	contentItemId: itemId,
	sha256: "1".repeat(64),
	mediaType: "audio/aac" as const,
	byteLength: 2_621_440,
	version: 2,
	createdAt: "2026-09-01T00:00:00.000Z",
}
const list: ListPisoCampAssetsOutput = {
	currentVersionId: "f507f4c6-f3e1-48fe-9e23-bf53731ee99b",
	currentVersionNo: 3,
	attachments: [attachment],
	available: [available],
}
const mutationOutput: PisoCampAssetMutationOutput = {
	asset: attachment.asset,
	currentVersionId: "7d293098-b1f7-4f94-a0ae-bf09c48af489",
	currentVersionNo: 4,
	attachments: [attachment],
}

function mutation(mutateAsync = vi.fn().mockResolvedValue(mutationOutput), isPending = false) {
	return { mutateAsync, isPending, isError: false, error: null, reset: vi.fn() }
}

function setupHooks() {
	useAssets.mockReturnValue({
		data: list,
		isPending: false,
		isError: false,
		refetch: vi.fn().mockResolvedValue({ data: list, status: "success", isError: false }),
	})
	useUpload.mockReturnValue(mutation())
	useAttach.mockReturnValue(mutation())
	useDetach.mockReturnValue(mutation())
	useDelete.mockReturnValue(mutation())
}

describe("AssetAttachmentsEditor", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setupHooks()
	})

	it("hides all asset metadata and mutation controls without the independent permission", () => {
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets={false}
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)

		expect(screen.queryByRole("region", { name: /draft assets/i })).not.toBeInTheDocument()
		expect(screen.queryByLabelText(/asset file/i)).not.toBeInTheDocument()
		expect(useAssets).toHaveBeenCalledWith({ itemId }, false)
	})

	it("provides labelled native controls and exact role, format, and size policy guidance", async () => {
		const user = userEvent.setup()
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)

		const root = screen.getByRole("region", { name: "Draft assets" })
		expect(root).toHaveClass("w-full", "max-w-full", "min-w-0")
		expect(root).not.toHaveClass("overflow-hidden")
		expect(screen.getByText(/Images: PNG, JPEG, or WebP up to 10 MiB/)).toHaveTextContent(
			"Images: PNG, JPEG, or WebP up to 10 MiB for obverse, reverse, edge, or texture. Audio: MP3 or AAC up to 25 MiB for audio. Models: GLB, embedded GLTF, or USDZ up to 50 MiB for animation."
		)
		const role = screen.getByRole("combobox", { name: "Asset role" })
		const file = screen.getByLabelText("Asset file")
		expect(file).toHaveAttribute("type", "file")
		expect(file).toHaveAttribute("accept", ".png,.jpg,.jpeg,.webp,.mp3,.aac,.glb,.gltf,.usdz")
		expect(role).toHaveClass("min-h-11", "w-full", "min-w-0", "whitespace-normal")
		expect(file).toHaveClass("min-h-11", "w-full", "min-w-0")
		await user.click(role)
		expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual([
			"Obverse",
			"Reverse",
			"Edge",
			"Texture",
			"Audio",
			"Animation",
		])
		expect(root.querySelector("img, audio, video, canvas, model-viewer")).toBeNull()
	})

	it("locks every mutation while content is dirty and explains how to unlock it", () => {
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty
				onVersionChanged={vi.fn()}
			/>
		)

		expect(screen.getByText("Save your content changes before managing assets.")).toBeVisible()
		expect(screen.getByLabelText("Asset file")).toBeDisabled()
		expect(screen.getByRole("combobox", { name: "Asset role" })).toBeDisabled()
		for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled()
	})

	it("uploads the selected file for the retained role and synchronizes the returned version", async () => {
		const user = userEvent.setup()
		const upload = vi.fn().mockResolvedValue(mutationOutput)
		const onVersionChanged = vi.fn().mockResolvedValue(undefined)
		useUpload.mockReturnValue(mutation(upload))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={onVersionChanged}
			/>
		)
		const file = new File([new Uint8Array([137, 80, 78, 71])], "safe.png", {
			type: "image/png",
		})

		await user.upload(screen.getByLabelText("Asset file"), file)
		await user.click(screen.getByRole("button", { name: "Upload asset" }))

		expect(upload).toHaveBeenCalledWith(
			expect.objectContaining({
				file,
				itemId,
				expectedVersionNo: 3,
				role: "obverse",
				requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			})
		)
		expect(onVersionChanged).toHaveBeenCalledWith(4)
		expect(onVersionChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
			upload.mock.invocationCallOrder[0]!
		)
	})

	it.each([
		[400, "The file is invalid or does not match the selected role."],
		[413, "The file exceeds the allowed size for its format."],
		[409, "The draft changed or the selected role is occupied. Reload the latest version."],
	] as const)(
		"shows a safe focused %i error while retaining the selected role",
		async (status, copy) => {
			const user = userEvent.setup()
			useUpload.mockReturnValue(mutation(vi.fn().mockRejectedValue({ status })))
			render(
				<AssetAttachmentsEditor
					itemId={itemId}
					expectedVersionNo={3}
					canManageAssets
					contentDirty={false}
					onVersionChanged={vi.fn()}
				/>
			)
			const role = screen.getByRole("combobox", { name: "Asset role" })
			await user.click(role)
			await user.click(await screen.findByRole("option", { name: "Audio" }))
			const selectedFile = new File([new Uint8Array([255, 241, 80, 128])], "clip.aac", {
				type: "audio/aac",
			})
			await user.upload(screen.getByLabelText("Asset file"), selectedFile)
			await user.click(screen.getByRole("button", { name: "Upload asset" }))

			const alert = await screen.findByRole("alert")
			expect(alert).toHaveTextContent(copy)
			await waitFor(() => expect(alert).toHaveFocus())
			expect(screen.getByRole("combobox", { name: "Asset role" })).toHaveTextContent("Audio")
			expect(screen.getByLabelText<HTMLInputElement>("Asset file").files?.[0]).toBe(selectedFile)
			expect(alert).not.toHaveTextContent(/clip\.aac|private|stack/i)
			if (status === 409) {
				expect(screen.getByRole("combobox", { name: "Asset role" })).toBeDisabled()
				expect(screen.getByLabelText("Asset file")).toBeDisabled()
				for (const button of screen.getAllByRole("button")) {
					if (button.textContent === "Reload latest assets") expect(button).toBeEnabled()
					else expect(button).toBeDisabled()
				}
			}
		}
	)

	it("blocks a same-tick duplicate upload before mutation pending state renders", async () => {
		const user = userEvent.setup()
		const upload = vi.fn(() => new Promise<PisoCampAssetMutationOutput>(() => undefined))
		useUpload.mockReturnValue(mutation(upload))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)
		await user.upload(
			screen.getByLabelText("Asset file"),
			new File([new Uint8Array([137, 80, 78, 71])], "safe.png", { type: "image/png" })
		)
		const uploadButton = screen.getByRole("button", { name: "Upload asset" })

		act(() => {
			uploadButton.click()
			uploadButton.click()
		})

		expect(upload).toHaveBeenCalledTimes(1)
	})

	it.each([
		[
			"resolved error with an error value",
			() =>
				Promise.resolve({
					data: undefined,
					status: "error",
					isError: true,
					error: new Error("private resolved query detail"),
				}),
		],
		[
			"resolved error without an error value",
			() => Promise.resolve({ data: undefined, status: "error", isError: true }),
		],
		[
			"resolved success without usable data",
			() => Promise.resolve({ data: undefined, status: "success", isError: false }),
		],
		["rejected query", () => Promise.reject(new Error("private rejected query detail"))],
	] as const)(
		"keeps the fixed conflict and mutation lock after a %s reload",
		async (_label, reload) => {
			const user = userEvent.setup()
			const refetch = vi.fn(reload)
			useAssets.mockReturnValue({ data: list, isPending: false, isError: false, refetch })
			useUpload.mockReturnValue(mutation(vi.fn().mockRejectedValue({ status: 409 })))
			render(
				<AssetAttachmentsEditor
					itemId={itemId}
					expectedVersionNo={3}
					canManageAssets
					contentDirty={false}
					onVersionChanged={vi.fn()}
				/>
			)
			const selectedFile = new File([new Uint8Array([137, 80, 78, 71])], "safe.png", {
				type: "image/png",
			})
			await user.upload(screen.getByLabelText("Asset file"), selectedFile)
			await user.click(screen.getByRole("button", { name: "Upload asset" }))
			await user.click(await screen.findByRole("button", { name: "Reload latest assets" }))

			await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
			const alert = await screen.findByRole("alert")
			expect(alert).toHaveTextContent(
				"The draft changed or the selected role is occupied. Reload the latest version."
			)
			expect(alert).not.toHaveTextContent(/private resolved|private rejected/i)
			await waitFor(() => expect(alert).toHaveFocus())
			expect(screen.getByLabelText<HTMLInputElement>("Asset file").files?.[0]).toBe(selectedFile)
			expect(screen.getByRole("combobox", { name: "Asset role" })).toBeDisabled()
			expect(screen.getByLabelText("Asset file")).toBeDisabled()
			for (const button of screen.getAllByRole("button")) {
				if (button.textContent === "Reload latest assets") expect(button).toBeEnabled()
				else expect(button).toBeDisabled()
			}
		}
	)

	it("reuses the upload request id when a lost-response retry keeps the same file and role", async () => {
		const user = userEvent.setup()
		const upload = vi
			.fn()
			.mockRejectedValueOnce(new Error("connection-lost"))
			.mockResolvedValueOnce(mutationOutput)
		useUpload.mockReturnValue(mutation(upload))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)
		await user.upload(
			screen.getByLabelText("Asset file"),
			new File([new Uint8Array([137, 80, 78, 71])], "safe.png", { type: "image/png" })
		)

		await user.click(screen.getByRole("button", { name: "Upload asset" }))
		await screen.findByRole("alert")
		await user.click(screen.getByRole("button", { name: "Upload asset" }))

		expect(upload).toHaveBeenCalledTimes(2)
		expect(upload.mock.calls[0]?.[0].requestId).toBe(upload.mock.calls[1]?.[0].requestId)
	})

	it("announces pending work and prevents a second asset mutation", () => {
		useUpload.mockReturnValue(mutation(vi.fn(), true))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)

		expect(screen.getByRole("status")).toHaveTextContent("Asset update in progress…")
		expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
		expect(screen.getByLabelText("Asset file")).toBeDisabled()
		for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled()
	})

	it("shows safe wrapping metadata and exposes the full checksum to assistive technology", () => {
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)

		const group = screen.getByRole("group", { name: "Obverse attachment" })
		expect(group).toHaveClass("w-full", "max-w-full", "min-w-0", "break-words")
		expect(group).toHaveTextContent("image/png")
		expect(group).toHaveTextContent("1 KiB")
		expect(group).toHaveTextContent("Asset version 1")
		expect(group).toHaveTextContent("abcdef012345…")
		expect(screen.getByLabelText(`Full SHA-256 checksum ${sha256}`)).toBeInTheDocument()
	})

	it("requires explicit confirmation before detach and delete", async () => {
		const user = userEvent.setup()
		const detach = vi.fn().mockResolvedValue(mutationOutput)
		const remove = vi.fn().mockResolvedValue(mutationOutput)
		useDetach.mockReturnValue(mutation(detach))
		useDelete.mockReturnValue(mutation(remove))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)

		await user.click(screen.getByRole("button", { name: "Detach obverse asset" }))
		expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Detach Obverse Asset?")
		expect(detach).not.toHaveBeenCalled()
		await user.click(screen.getByRole("button", { name: "Confirm detach" }))
		expect(detach).toHaveBeenCalledWith(
			expect.objectContaining({
				assetId: attachedAssetId,
				itemId,
				expectedVersionNo: 3,
				role: "obverse",
			})
		)
		await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())

		await user.click(screen.getByRole("button", { name: "Delete obverse asset" }))
		expect(screen.getByRole("alertdialog")).toHaveAccessibleName("Delete Obverse Asset?")
		expect(remove).not.toHaveBeenCalled()
		await user.click(screen.getByRole("button", { name: "Confirm delete" }))
		expect(remove).toHaveBeenCalledWith(
			expect.objectContaining({
				assetId: attachedAssetId,
				itemId,
				expectedVersionNo: 3,
			})
		)
	})

	it("attaches an available asset to the selected role and keeps keyboard controls in document order", async () => {
		const user = userEvent.setup()
		const attach = vi.fn().mockResolvedValue(mutationOutput)
		useAttach.mockReturnValue(mutation(attach))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={vi.fn()}
			/>
		)

		const role = screen.getByRole("combobox", { name: "Asset role" })
		const file = screen.getByLabelText("Asset file")
		const upload = screen.getByRole("button", { name: "Upload asset" })
		await user.upload(
			file,
			new File([new Uint8Array([137, 80, 78, 71])], "safe.png", { type: "image/png" })
		)
		role.focus()
		expect(role).toHaveFocus()
		await user.tab()
		expect(file).toHaveFocus()
		await user.tab()
		expect(upload).toHaveFocus()

		const availableGroup = screen.getByRole("group", { name: "Available asset 111111111111" })
		await user.click(within(availableGroup).getByRole("button", { name: "Attach as obverse" }))
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ assetId: availableAssetId, role: "obverse", expectedVersionNo: 3 })
		)
	})

	it("clears a stale conflict only after the latest asset and content version synchronize", async () => {
		const user = userEvent.setup()
		const latest = { ...list, currentVersionNo: 8 }
		const refetch = vi.fn().mockResolvedValue({ data: latest, status: "success", isError: false })
		let finishSynchronization: (() => void) | undefined
		const synchronization = new Promise<void>(resolve => {
			finishSynchronization = resolve
		})
		const onVersionChanged = vi.fn().mockReturnValue(synchronization)
		useAssets.mockReturnValue({ data: list, isPending: false, isError: false, refetch })
		useUpload.mockReturnValue(mutation(vi.fn().mockRejectedValue({ status: 409 })))
		render(
			<AssetAttachmentsEditor
				itemId={itemId}
				expectedVersionNo={3}
				canManageAssets
				contentDirty={false}
				onVersionChanged={onVersionChanged}
			/>
		)

		await user.upload(
			screen.getByLabelText("Asset file"),
			new File([new Uint8Array([137, 80, 78, 71])], "safe.png", { type: "image/png" })
		)
		await user.click(screen.getByRole("button", { name: "Upload asset" }))
		await user.click(await screen.findByRole("button", { name: "Reload latest assets" }))

		expect(refetch).toHaveBeenCalledTimes(1)
		await waitFor(() => expect(onVersionChanged).toHaveBeenLastCalledWith(8))
		expect(screen.getByRole("alert")).toHaveTextContent(/draft changed.*reload the latest/is)
		expect(screen.getByRole("combobox", { name: "Asset role" })).toBeDisabled()
		finishSynchronization?.()
		await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
		expect(screen.getByRole("combobox", { name: "Asset role" })).toBeEnabled()
		expect(screen.getByLabelText("Asset file")).toBeEnabled()
		expect(screen.getByRole("button", { name: "Upload asset" })).toBeEnabled()
	})
})
