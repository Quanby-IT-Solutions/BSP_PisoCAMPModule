import {
	Controller,
	Get,
	HttpStatus,
	Param,
	Query,
	Res,
	ServiceUnavailableException,
} from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { PisoCampContentPreviewTokenSchema } from "@repo/contracts/pisocamp-preview"

import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { PreviewService } from "./preview.service"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A preview is never cacheable.
 *
 * `no-store` is the mechanism behind "renders that version once without
 * caching it as published": no shared cache, browser cache or service worker
 * may retain unpublished content, and the mobile preview build cannot promote
 * it into the offline bundle store.
 */
export const PREVIEW_CACHE_CONTROL = "no-store"

/**
 * Raw preview media, addressed by asset id and authorised by the grant.
 *
 * Kept off the oRPC surface for the same reason `BundleResourceController` is:
 * `<img>` and `<audio>` need real bytes with a real content type, which the
 * JSON contract cannot express.
 */
@Controller({ path: "pisocamp/preview/resources", version: "1" })
export class PreviewResourceController {
	constructor(private readonly previewService: PreviewService) {}

	@AllowAnonymous()
	@StrictThrottle()
	@Get(":assetId")
	async getResource(
		@Param("assetId") assetId: string,
		@Query("token") token: string | undefined,
		@Res() response: Response
	): Promise<void> {
		response.setHeader("Cache-Control", PREVIEW_CACHE_CONTROL)
		response.setHeader("X-Content-Type-Options", "nosniff")
		// A preview asset is unpublished BSP content; never let another origin
		// frame it or a referrer carry the grant off-site.
		response.setHeader("Referrer-Policy", "no-referrer")

		const parsedToken = PisoCampContentPreviewTokenSchema.safeParse(token)
		if (!parsedToken.success || !UUID_PATTERN.test(assetId)) {
			response.status(HttpStatus.NOT_FOUND).end()
			return
		}

		let asset: Awaited<ReturnType<PreviewService["readAsset"]>>
		try {
			asset = await this.previewService.readAsset(parsedToken.data, assetId)
		} catch (error) {
			if (error instanceof ORPCError && error.code === "UNAUTHORIZED") {
				response.status(HttpStatus.UNAUTHORIZED).end()
				return
			}
			if (error instanceof ORPCError && error.code === "NOT_FOUND") {
				response.status(HttpStatus.NOT_FOUND).end()
				return
			}
			throw new ServiceUnavailableException("Preview asset is temporarily unavailable")
		}

		response.setHeader("Content-Type", asset.mediaType)
		response.setHeader("Content-Length", asset.byteLength)
		response.setHeader("ETag", `"${asset.sha256}"`)
		response.status(HttpStatus.OK).send(asset.bytes)
	}
}
