import { Inject, Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"

import type {
	GetPisoCampContentPreviewInput,
	PisoCampContentPreview,
	PisoCampContentPreviewGrant,
	PisoCampPreviewableStatus,
} from "@repo/contracts"
import { PISO_CAMP_PREVIEWABLE_STATUSES } from "@repo/contracts/pisocamp-preview"
import { contentVersions } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { AssetObjectCorruptionError, PostgresAssetObjectStore } from "../assets/asset-object-store"
import { selectVersionAssets } from "../assets/version-assets"
import {
	fromContentVersion,
	selectContentLinks,
	withTriviaDetail,
} from "../content/content-mapping"
import {
	PreviewTokenError,
	signPreviewToken,
	verifyPreviewToken,
	type PreviewTokenClaims,
} from "./preview-token"

export const PREVIEW_TOKEN_CONFIG = Symbol("PISOCAMP_PREVIEW_TOKEN_CONFIG")

export interface PreviewTokenConfig {
	key: Buffer
	ttlSeconds: number
}

const PREVIEWABLE = new Set<string>(PISO_CAMP_PREVIEWABLE_STATUSES)

/** One fixed message for every unusable grant, so a probe learns nothing. */
const INVALID_GRANT = "Preview link is invalid or has expired"

export interface PreviewAssetBytes {
	mediaType: string
	byteLength: number
	sha256: string
	bytes: Buffer
}

/**
 * CM-5 pre-publication preview.
 *
 * Read-only by construction: nothing here writes to `content_item`,
 * `content_version`, `version_asset` or any bundle table, so generating or
 * redeeming a preview cannot move a publication flag or place a version in a
 * bundle. The only write is the append-only audit entry the ticket requires.
 */
@Injectable()
export class PreviewService {
	constructor(
		private readonly auditService: AuditService,
		private readonly objectStore: PostgresAssetObjectStore,
		@Inject(PREVIEW_TOKEN_CONFIG) private readonly config: PreviewTokenConfig
	) {}

	async createGrant(
		input: GetPisoCampContentPreviewInput,
		actorId: string
	): Promise<PisoCampContentPreviewGrant> {
		const version = await this.requireVersionByNumber(input.itemId, input.versionNo)
		const preview = await this.render(version)
		const expiresAt = new Date(Date.now() + this.config.ttlSeconds * 1_000)
		const token = signPreviewToken(this.config.key, {
			itemId: preview.itemId,
			versionId: preview.versionId,
			versionNo: preview.versionNo,
			status: preview.status,
			actorId,
			expiresAt: expiresAt.getTime(),
		})

		await this.auditService.record({
			domain: "content",
			action: "content.preview",
			actorId,
			targetType: "content_version",
			targetId: preview.versionId,
			newValue: {
				itemId: preview.itemId,
				versionNo: preview.versionNo,
				status: preview.status,
				expiresAt: expiresAt.toISOString(),
			},
		})

		return { preview, token, expiresAt: expiresAt.toISOString() }
	}

	async redeem(token: string): Promise<PisoCampContentPreview> {
		const claims = this.verify(token)
		return this.render(await this.requireGrantedVersion(claims))
	}

	async readAsset(token: string, assetId: string): Promise<PreviewAssetBytes> {
		const claims = this.verify(token)
		const version = await this.requireGrantedVersion(claims)
		const attachments = await selectVersionAssets(db, version.itemId, version.id)
		const attached = attachments.find(entry => entry.asset.id === assetId)
		if (!attached) throw new ORPCError("NOT_FOUND", { message: "Preview asset not found" })

		let stored: Awaited<ReturnType<PostgresAssetObjectStore["readByDigest"]>>
		try {
			stored = await this.objectStore.readByDigest(db, attached.asset.sha256)
		} catch (error) {
			if (error instanceof AssetObjectCorruptionError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Preview asset is unavailable" })
			}
			throw error
		}
		if (!stored) throw new ORPCError("NOT_FOUND", { message: "Preview asset not found" })

		return {
			mediaType: stored.mediaType,
			byteLength: stored.byteLength,
			sha256: stored.sha256,
			bytes: stored.bytes,
		}
	}

	private verify(token: string): PreviewTokenClaims {
		try {
			return verifyPreviewToken(this.config.key, token, new Date())
		} catch (error) {
			if (error instanceof PreviewTokenError) {
				throw new ORPCError("UNAUTHORIZED", { message: INVALID_GRANT })
			}
			throw error
		}
	}

	/**
	 * Re-read the exact version the grant names and confirm it is still
	 * previewable.
	 *
	 * The claims are signed, but the workflow keeps moving: a version approved
	 * when the grant was minted may have been published seconds later. Trusting
	 * the claim's status would let a stale grant keep serving a state the item
	 * has left, so the live row decides.
	 */
	private async requireGrantedVersion(claims: PreviewTokenClaims) {
		const [version] = await db
			.select()
			.from(contentVersions)
			.where(
				and(eq(contentVersions.id, claims.versionId), eq(contentVersions.itemId, claims.itemId))
			)
		if (!version || version.versionNo !== claims.versionNo || !PREVIEWABLE.has(version.status)) {
			throw new ORPCError("UNAUTHORIZED", { message: INVALID_GRANT })
		}
		return version
	}

	private async requireVersionByNumber(itemId: string, versionNo: number) {
		const [version] = await db
			.select()
			.from(contentVersions)
			.where(and(eq(contentVersions.itemId, itemId), eq(contentVersions.versionNo, versionNo)))
		if (!version) throw new ORPCError("NOT_FOUND", { message: "Content version not found" })
		if (!PREVIEWABLE.has(version.status)) {
			throw new ORPCError("CONFLICT", {
				message: "Only draft, submitted or approved versions can be previewed",
			})
		}
		return version
	}

	private async render(
		version: typeof contentVersions.$inferSelect
	): Promise<PisoCampContentPreview> {
		const [relatedLinks, attachments] = await Promise.all([
			selectContentLinks(db, version.id),
			selectVersionAssets(db, version.itemId, version.id),
		])
		return {
			itemId: version.itemId,
			versionId: version.id,
			versionNo: version.versionNo,
			status: version.status as PisoCampPreviewableStatus,
			contentType: version.contentType,
			content: fromContentVersion(await withTriviaDetail(db, version)),
			relatedLinks,
			assets: attachments.map(entry => ({
				role: entry.role,
				assetId: entry.asset.id,
				mediaType: entry.asset.mediaType,
				byteLength: entry.asset.byteLength,
				sha256: entry.asset.sha256,
			})),
			generatedAt: new Date().toISOString(),
		}
	}
}
