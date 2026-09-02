"use client"

import { useEffect, useRef, useState } from "react"

import type { PisoCampAsset, PisoCampAssetMutationOutput, PisoCampAssetRole } from "@repo/contracts"

import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/core/components/ui/alert-dialog"
import { Button } from "@/core/components/ui/button"
import { Field, FieldLabel, FieldSet } from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import {
	useAttachPisoCampAssetMutation,
	useDeletePisoCampAssetMutation,
	useDetachPisoCampAssetMutation,
	usePisoCampAssetsQuery,
	useUploadPisoCampAssetMutation,
} from "@/features/pisocamp-content-admin/api/assets.hooks"

interface AssetAttachmentsEditorProps {
	itemId: string
	expectedVersionNo: number
	canManageAssets: boolean
	contentDirty: boolean
	onVersionChanged: (versionNo: number) => void | Promise<void>
}

const ASSET_ROLES: readonly { value: PisoCampAssetRole; label: string }[] = [
	{ value: "obverse", label: "Obverse" },
	{ value: "reverse", label: "Reverse" },
	{ value: "edge", label: "Edge" },
	{ value: "texture", label: "Texture" },
	{ value: "audio", label: "Audio" },
	{ value: "animation", label: "Animation" },
]

const ACCEPTED_EXTENSIONS = ".png,.jpg,.jpeg,.webp,.mp3,.aac,.glb,.gltf,.usdz"
const POLICY_GUIDANCE =
	"Images: PNG, JPEG, or WebP up to 10 MiB for obverse, reverse, edge, or texture. Audio: MP3 or AAC up to 25 MiB for audio. Models: GLB, embedded GLTF, or USDZ up to 50 MiB for animation."

function roleLabel(role: PisoCampAssetRole) {
	return ASSET_ROLES.find(option => option.value === role)?.label ?? role
}

function isAssetRole(value: unknown): value is PisoCampAssetRole {
	return ASSET_ROLES.some(option => option.value === value)
}

function errorStatus(error: unknown) {
	if (!error || typeof error !== "object" || !("status" in error)) return undefined
	return typeof error.status === "number" ? error.status : undefined
}

function safeErrorCopy(error: unknown) {
	switch (errorStatus(error)) {
		case 400:
			return "The file is invalid or does not match the selected role."
		case 413:
			return "The file exceeds the allowed size for its format."
		case 409:
			return "The draft changed or the selected role is occupied. Reload the latest version."
		default:
			return "The asset update could not be completed. Check your connection and try again."
	}
}

function formatBytes(byteLength: number) {
	if (byteLength < 1_024) return `${byteLength} B`
	if (byteLength < 1_048_576) return `${Math.round(byteLength / 1_024)} KiB`
	const mib = byteLength / 1_048_576
	return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`
}

function AssetMetadata({ asset }: { asset: PisoCampAsset }) {
	return (
		<p className="text-muted-foreground min-w-0 text-sm break-words whitespace-normal">
			{asset.mediaType} · {formatBytes(asset.byteLength)} · Asset version {asset.version} ·{" "}
			<span aria-label={`Full SHA-256 checksum ${asset.sha256}`}>{asset.sha256.slice(0, 12)}…</span>
		</p>
	)
}

export function AssetAttachmentsEditor({
	itemId,
	expectedVersionNo,
	canManageAssets,
	contentDirty,
	onVersionChanged,
}: AssetAttachmentsEditorProps) {
	const assets = usePisoCampAssetsQuery({ itemId }, canManageAssets)
	const uploadAsset = useUploadPisoCampAssetMutation()
	const attachAsset = useAttachPisoCampAssetMutation()
	const detachAsset = useDetachPisoCampAssetMutation()
	const deleteAsset = useDeletePisoCampAssetMutation()
	const [role, setRole] = useState<PisoCampAssetRole>("obverse")
	const [file, setFile] = useState<File | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [synchronizing, setSynchronizing] = useState(false)
	const errorRef = useRef<HTMLDivElement>(null)
	const fileRef = useRef<HTMLInputElement>(null)
	const operationInFlight = useRef(false)
	const uploadRequestId = useRef<string | null>(null)

	const mutationPending =
		uploadAsset.isPending ||
		attachAsset.isPending ||
		detachAsset.isPending ||
		deleteAsset.isPending ||
		synchronizing
	const versionConflict = errorStatus(error) === 409
	const locked = contentDirty || mutationPending || versionConflict

	useEffect(() => {
		if (!error) return
		const frame = requestAnimationFrame(() => errorRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [error])

	if (!canManageAssets) return null

	async function runMutation(operation: () => Promise<PisoCampAssetMutationOutput>) {
		if (locked || operationInFlight.current) return
		operationInFlight.current = true
		setError(null)
		setSynchronizing(true)
		try {
			const result = await operation()
			await onVersionChanged(result.currentVersionNo)
			return result
		} catch (nextError) {
			setError(nextError)
			return undefined
		} finally {
			operationInFlight.current = false
			setSynchronizing(false)
		}
	}

	async function upload() {
		if (!file) return
		const result = await runMutation(() =>
			uploadAsset.mutateAsync({
				file,
				itemId,
				expectedVersionNo,
				role,
				requestId: (uploadRequestId.current ??= crypto.randomUUID()),
			})
		)
		if (!result) return
		uploadRequestId.current = null
		setFile(null)
		if (fileRef.current) fileRef.current.value = ""
	}

	async function attach(assetId: string) {
		await runMutation(() =>
			attachAsset.mutateAsync({
				assetId,
				itemId,
				expectedVersionNo,
				role,
				requestId: crypto.randomUUID(),
			})
		)
	}

	async function detach(assetId: string, attachmentRole: PisoCampAssetRole) {
		await runMutation(() =>
			detachAsset.mutateAsync({
				assetId,
				itemId,
				expectedVersionNo,
				role: attachmentRole,
				requestId: crypto.randomUUID(),
			})
		)
	}

	async function remove(assetId: string) {
		await runMutation(() =>
			deleteAsset.mutateAsync({
				assetId,
				itemId,
				expectedVersionNo,
				requestId: crypto.randomUUID(),
			})
		)
	}

	async function reloadLatest() {
		setSynchronizing(true)
		try {
			const result = await assets.refetch()
			if (result.status !== "success" || !result.data) {
				setError({ status: 409 })
				return
			}
			await onVersionChanged(result.data.currentVersionNo)
			setError(null)
		} catch {
			setError({ status: 409 })
		} finally {
			setSynchronizing(false)
		}
	}

	return (
		<section
			aria-labelledby="draft-assets-title"
			className="w-full max-w-full min-w-0 space-y-4 rounded-lg border p-[8px] sm:p-4"
		>
			<div className="min-w-0 space-y-1">
				<h3 id="draft-assets-title" className="font-medium break-words whitespace-normal">
					Draft assets
				</h3>
				<p id="asset-policy-guidance" className="text-muted-foreground text-sm break-words">
					{POLICY_GUIDANCE}
				</p>
			</div>

			{contentDirty ? (
				<p className="text-muted-foreground text-sm" role="status">
					Save your content changes before managing assets.
				</p>
			) : null}
			{mutationPending ? (
				<p role="status" aria-live="polite" className="text-muted-foreground text-sm">
					Asset update in progress…
				</p>
			) : null}
			{error ? (
				<Alert ref={errorRef} tabIndex={-1} variant="destructive">
					<AlertTitle>Asset Update Not Completed</AlertTitle>
					<AlertDescription>
						{safeErrorCopy(error)}
						{errorStatus(error) === 409 ? (
							<Button
								type="button"
								variant="outline"
								className="mt-3 h-auto min-h-11 w-full touch-manipulation whitespace-normal sm:w-auto"
								disabled={mutationPending}
								onClick={() => void reloadLatest()}
							>
								Reload latest assets
							</Button>
						) : null}
					</AlertDescription>
				</Alert>
			) : null}

			<div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
				<Field className="min-w-0">
					<FieldLabel htmlFor="asset-role">Asset role</FieldLabel>
					<Select
						name="assetRole"
						value={role}
						disabled={locked}
						onValueChange={value => {
							if (isAssetRole(value)) {
								setRole(value)
								uploadRequestId.current = null
							}
						}}
					>
						<SelectTrigger
							id="asset-role"
							wrapValue
							className="h-auto min-h-11 w-full max-w-full min-w-0 whitespace-normal"
						>
							<SelectValue className="min-w-0 break-words whitespace-normal">
								{roleLabel(role)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{ASSET_ROLES.map(option => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Field className="min-w-0">
					<FieldLabel htmlFor="asset-file">Asset file</FieldLabel>
					<Input
						ref={fileRef}
						id="asset-file"
						name="assetFile"
						type="file"
						accept={ACCEPTED_EXTENSIONS}
						aria-describedby="asset-policy-guidance"
						disabled={locked}
						className="h-auto min-h-11 w-full max-w-full min-w-0 file:mr-2 file:min-h-9"
						onChange={event => {
							setFile(event.target.files?.[0] ?? null)
							uploadRequestId.current = null
						}}
					/>
				</Field>
			</div>
			<Button
				type="button"
				className="h-auto min-h-11 w-full touch-manipulation whitespace-normal sm:w-auto"
				disabled={locked || !file}
				onClick={() => void upload()}
			>
				Upload asset
			</Button>

			{assets.isPending ? (
				<p role="status" aria-live="polite">
					Loading draft assets…
				</p>
			) : assets.isError || !assets.data ? (
				<Alert variant="destructive">
					<AlertTitle>Could Not Load Assets</AlertTitle>
					<AlertDescription>
						Try loading the asset list again.
						<Button
							type="button"
							variant="outline"
							className="mt-3 min-h-11 w-full whitespace-normal sm:w-auto"
							disabled={locked}
							onClick={() => void assets.refetch()}
						>
							Try again
						</Button>
					</AlertDescription>
				</Alert>
			) : (
				<div className="grid w-full min-w-0 gap-4 lg:grid-cols-2">
					<FieldSet className="w-full max-w-full min-w-0 space-y-3 rounded-lg border p-[8px] sm:p-3">
						<legend className="font-medium break-words">Current attachments</legend>
						{assets.data.attachments.length === 0 ? (
							<p className="text-muted-foreground text-sm">No assets are attached.</p>
						) : null}
						{assets.data.attachments.map(current => (
							<div
								key={current.role}
								role="group"
								aria-label={`${roleLabel(current.role)} attachment`}
								className="bg-muted/30 w-full max-w-full min-w-0 space-y-2 rounded-lg p-[8px] break-words sm:p-3"
							>
								<p className="font-medium">{roleLabel(current.role)}</p>
								<AssetMetadata asset={current.asset} />
								<div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap">
									<AlertDialog>
										<AlertDialogTrigger
											render={
												<Button
													type="button"
													variant="outline"
													className="min-h-11 w-full whitespace-normal sm:w-auto"
													disabled={locked}
													aria-label={`Detach ${current.role} asset`}
												/>
											}
										>
											Detach
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Detach {roleLabel(current.role)} Asset?</AlertDialogTitle>
												<AlertDialogDescription>
													A new draft version will be created without this attachment.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
												<AlertDialogCancel
													variant="default"
													className="min-h-11"
													onClick={() => void detach(current.asset.id, current.role)}
												>
													Confirm detach
												</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
									<AlertDialog>
										<AlertDialogTrigger
											render={
												<Button
													type="button"
													variant="destructive"
													className="min-h-11 w-full whitespace-normal sm:w-auto"
													disabled={locked}
													aria-label={`Delete ${current.role} asset`}
												/>
											}
										>
											Delete
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Delete {roleLabel(current.role)} Asset?</AlertDialogTitle>
												<AlertDialogDescription>
													The asset will be tombstoned and removed from the current draft.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
												<AlertDialogCancel
													variant="destructive"
													className="min-h-11"
													onClick={() => void remove(current.asset.id)}
												>
													Confirm delete
												</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</div>
							</div>
						))}
					</FieldSet>

					<FieldSet className="w-full max-w-full min-w-0 space-y-3 rounded-lg border p-[8px] sm:p-3">
						<legend className="font-medium break-words">Available assets</legend>
						{assets.data.available.length === 0 ? (
							<p className="text-muted-foreground text-sm">No unattached assets are available.</p>
						) : null}
						{assets.data.available.map(asset => (
							<div
								key={asset.id}
								role="group"
								aria-label={`Available asset ${asset.sha256.slice(0, 12)}`}
								className="bg-muted/30 w-full max-w-full min-w-0 space-y-2 rounded-lg p-[8px] break-words sm:p-3"
							>
								<AssetMetadata asset={asset} />
								<Button
									type="button"
									variant="outline"
									className="min-h-11 w-full whitespace-normal sm:w-auto"
									disabled={locked}
									onClick={() => void attach(asset.id)}
								>
									Attach as {role}
								</Button>
							</div>
						))}
					</FieldSet>
				</div>
			)}
		</section>
	)
}
