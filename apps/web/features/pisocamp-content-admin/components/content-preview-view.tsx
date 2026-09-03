"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import type { PisoCampContentPreview, PisoCampContentPreviewAsset } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/core/components/ui/alert"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	pisoCampPreviewAssetUrl,
	pisoCampPreviewRedeemUrl,
	usePisoCampContentPreviewQuery,
} from "@/features/pisocamp-content-admin/api/preview.hooks"

const MANILA_TIME_FORMATTER = new Intl.DateTimeFormat("en-PH", {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
	timeZone: "Asia/Manila",
})

const IMAGE_ROLES = new Set(["obverse", "reverse", "edge", "texture"])

const ROLE_LABELS: Record<PisoCampContentPreviewAsset["role"], string> = {
	obverse: "Obverse",
	reverse: "Reverse",
	edge: "Edge",
	texture: "Texture",
	audio: "Narration",
	animation: "Animation",
	// AR-2. The model an AR experience places, distinct from the animation
	// that moves it.
	ar_model: "AR model",
}

function titleCase(value: string) {
	const label = value.split("_").join(" ")
	return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

/**
 * The scannable preview code.
 *
 * Rendered as inline SVG rather than a canvas so it scales with the page, keeps
 * working under forced colours, and carries its own accessible name. The QR
 * payload is the redemption URL, so any camera can open it and the mobile
 * preview build receives the same grant the console holds.
 */
function PreviewCode({ token, expiresAt }: { token: string; expiresAt: string }) {
	const [markup, setMarkup] = useState<string | null>(null)
	const [failed, setFailed] = useState(false)
	const redeemUrl = pisoCampPreviewRedeemUrl(token)

	useEffect(() => {
		let cancelled = false
		setMarkup(null)
		setFailed(false)
		void import("qrcode")
			.then(module =>
				module.default.toString(redeemUrl, {
					type: "svg",
					errorCorrectionLevel: "M",
					margin: 1,
				})
			)
			.then(svg => {
				if (!cancelled) setMarkup(svg)
			})
			.catch(() => {
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [redeemUrl])

	return (
		<div className="flex min-w-0 flex-col gap-3">
			{markup ? (
				<div
					data-testid="preview-code"
					role="img"
					aria-label="Preview code for the Piso CAMP preview build"
					className="bg-background w-40 max-w-full self-start rounded border p-2 [&_svg]:h-auto [&_svg]:w-full"
					dangerouslySetInnerHTML={{ __html: markup }}
				/>
			) : failed ? (
				<p className="text-muted-foreground text-sm">
					The preview code could not be drawn. Use the preview link below instead.
				</p>
			) : (
				<Skeleton className="size-40 max-w-full" />
			)}
			<div className="min-w-0 space-y-1">
				<p className="text-muted-foreground text-sm">
					Scan this code with a Piso CAMP preview build, or paste the link below into its preview
					screen.
				</p>
				<p className="text-muted-foreground text-xs break-all" data-testid="preview-redeem-url">
					{redeemUrl}
				</p>
				<p className="text-muted-foreground text-xs">
					This code stops working at{" "}
					<time dateTime={expiresAt}>
						{MANILA_TIME_FORMATTER.format(new Date(expiresAt))} (Asia/Manila)
					</time>
					.
				</p>
			</div>
		</div>
	)
}

function PreviewAssets({ preview, token }: { preview: PisoCampContentPreview; token: string }) {
	const images = preview.assets.filter(asset => IMAGE_ROLES.has(asset.role))
	const audio = preview.assets.filter(asset => asset.role === "audio")
	const models = preview.assets.filter(asset => asset.role === "animation")

	if (!preview.assets.length) {
		return <p className="text-muted-foreground text-sm">No assets are attached to this version.</p>
	}

	return (
		<div className="min-w-0 space-y-6">
			{images.length ? (
				<div className="grid min-w-0 gap-4 sm:grid-cols-2">
					{images.map(asset => (
						<figure key={asset.assetId} className="min-w-0 space-y-2">
							{/* eslint-disable-next-line @next/next/no-img-element -- token-authorised, no-store preview bytes must not pass through the image optimiser cache */}
							<img
								src={pisoCampPreviewAssetUrl(asset.assetId, token)}
								alt={`${ROLE_LABELS[asset.role]} image of ${preview.content.title}`}
								// max-h keeps a small or unusually shaped asset from being blown
								// up to fill the column; object-contain keeps its aspect ratio.
								className="h-auto max-h-80 w-full max-w-full rounded border object-contain"
							/>
							<figcaption className="text-muted-foreground text-sm">
								{ROLE_LABELS[asset.role]}
							</figcaption>
						</figure>
					))}
				</div>
			) : null}

			{audio.map(asset => (
				<div key={asset.assetId} className="min-w-0 space-y-2">
					<p className="text-sm font-medium">{ROLE_LABELS[asset.role]}</p>
					<audio
						controls
						preload="none"
						className="w-full max-w-full"
						aria-label={`Narration for ${preview.content.title}`}
						src={pisoCampPreviewAssetUrl(asset.assetId, token)}
					/>
				</div>
			))}

			{models.length ? (
				<p className="text-muted-foreground text-sm">
					A 3D or AR model is attached. Preview renders its description only; the interactive viewer
					is part of the mobile experience.
				</p>
			) : null}
		</div>
	)
}

export function ContentPreviewView({ itemId, versionNo }: { itemId: string; versionNo: number }) {
	const grant = usePisoCampContentPreviewQuery({ itemId, versionNo })
	const errorRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (grant.isError) errorRef.current?.focus()
	}, [grant.isError])

	if (grant.isPending) {
		return (
			<div role="status" aria-label="Loading preview…" className="space-y-3">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-96 w-full" />
				<span className="sr-only">Loading preview…</span>
			</div>
		)
	}

	if (grant.isError || !grant.data) {
		return (
			<Alert ref={errorRef} tabIndex={-1} role="alert" variant="destructive">
				<AlertTitle>Could Not Load Preview</AlertTitle>
				<AlertDescription>
					Only draft, submitted or approved versions can be previewed. Check your access and the
					version, then try again.
					<Button
						type="button"
						variant="outline"
						className="mt-3 min-h-11 touch-manipulation transition-colors"
						onClick={() => grant.refetch()}
					>
						Try Again
					</Button>
				</AlertDescription>
			</Alert>
		)
	}

	const { preview, token, expiresAt } = grant.data

	return (
		<div data-testid="content-preview-layout" className="w-full max-w-full min-w-0 space-y-6">
			<PageHeader
				title={preview.content.title}
				description={`Preview of version ${preview.versionNo}. Nothing here is published.`}
				wrapTitle
			/>

			<Alert role="status">
				<AlertTitle>Preview Only</AlertTitle>
				<AlertDescription>
					This is how version {preview.versionNo} will look to end users. Generating a preview does
					not publish anything and does not add this version to any offline bundle.
				</AlertDescription>
			</Alert>

			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="outline">{titleCase(preview.status)}</Badge>
				<Badge variant="outline">{titleCase(preview.contentType)}</Badge>
				<span className="text-muted-foreground text-sm">Version {preview.versionNo}</span>
			</div>

			<Card className="min-w-0 overflow-visible">
				<CardHeader>
					<CardTitle as="h2">End-User View</CardTitle>
				</CardHeader>
				<CardContent className="min-w-0 space-y-5">
					<p className="break-words">{preview.content.summary}</p>
					{"body" in preview.content && preview.content.body ? (
						<p className="break-words whitespace-pre-wrap">{preview.content.body}</p>
					) : null}
					{"seriesCode" in preview.content ? (
						<dl className="grid gap-2 sm:grid-cols-2">
							<div>
								<dt className="text-muted-foreground text-sm">Currency series</dt>
								<dd className="break-words">{preview.content.seriesCode}</dd>
							</div>
							<div>
								<dt className="text-muted-foreground text-sm">Denomination</dt>
								<dd className="break-words">{preview.content.denominationCode}</dd>
							</div>
						</dl>
					) : null}
					{"primaryUrl" in preview.content ? (
						<p className="break-all">
							<a
								className="underline underline-offset-4"
								href={preview.content.primaryUrl}
								rel="noreferrer noopener"
								target="_blank"
							>
								{preview.content.primaryUrl}
							</a>
						</p>
					) : null}
					<PreviewAssets preview={preview} token={token} />
				</CardContent>
			</Card>

			{preview.relatedLinks.length ? (
				<Card className="min-w-0 overflow-visible">
					<CardHeader>
						<CardTitle as="h2">Related Information</CardTitle>
					</CardHeader>
					<CardContent className="min-w-0">
						<ul className="space-y-3">
							{preview.relatedLinks.map(link => (
								<li key={link.id} className="min-w-0 break-words">
									<span className="font-medium">{link.label}</span>{" "}
									<span className="text-muted-foreground text-sm">
										{link.kind === "external"
											? link.url
											: link.kind === "internal"
												? link.route
												: `Topic ${link.targetContentItemId}`}
									</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}

			<Card className="min-w-0 overflow-visible">
				<CardHeader>
					<CardTitle as="h2">Preview On A Device</CardTitle>
				</CardHeader>
				<CardContent className="min-w-0">
					<PreviewCode token={token} expiresAt={expiresAt} />
				</CardContent>
			</Card>

			<Button
				variant="outline"
				className="min-h-11 touch-manipulation"
				render={<Link href={`/pisocamp/content/${itemId}/edit`} />}
			>
				Back To Content
			</Button>
		</div>
	)
}
