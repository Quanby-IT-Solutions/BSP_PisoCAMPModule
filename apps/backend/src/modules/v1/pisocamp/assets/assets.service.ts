import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, isNull } from "drizzle-orm"

import type {
	AttachPisoCampAssetInput,
	DeletePisoCampAssetInput,
	DetachPisoCampAssetInput,
	ListPisoCampAssetsOutput,
	PisoCampAssetMutationOutput,
	PisoCampAssetRole,
	UploadPisoCampAssetInput,
} from "@repo/contracts"
import { assets, contentItems, contentVersions, relatedLinks, versionAssets } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import {
	databaseTransactionContext,
	type DatabaseTransaction,
} from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

import type { PreparedAssetUpload } from "./asset-file-policy"
import { PostgresAssetObjectStore } from "./asset-object-store"
import {
	copyVersionAssets,
	isAssetRoleCompatible,
	mapAsset,
	selectVersionAssets,
} from "./version-assets"

interface LockedDraft {
	item: typeof contentItems.$inferSelect
	current: typeof contentVersions.$inferSelect
}

@Injectable()
export class AssetsService {
	constructor(
		private readonly auditService: AuditService,
		private readonly objectStore: PostgresAssetObjectStore
	) {}

	async list(itemId: string): Promise<ListPisoCampAssetsOutput> {
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, itemId))
		if (!item?.currentWorkingVersionId) {
			throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
		}
		const [current] = await db
			.select()
			.from(contentVersions)
			.where(
				and(
					eq(contentVersions.id, item.currentWorkingVersionId),
					eq(contentVersions.itemId, item.id)
				)
			)
		if (!current) throw new ORPCError("CONFLICT", { message: "Working version is missing" })
		const available = await db
			.select()
			.from(assets)
			.where(and(eq(assets.contentItemId, itemId), isNull(assets.deletedAt)))
			.orderBy(asc(assets.createdAt), asc(assets.id))
		return {
			currentVersionId: current.id,
			currentVersionNo: current.versionNo,
			attachments: await selectVersionAssets(db, item.id, current.id),
			available: available.map(mapAsset),
		}
	}

	async upload(
		prepared: PreparedAssetUpload,
		input: UploadPisoCampAssetInput,
		actorId: string
	): Promise<PisoCampAssetMutationOutput> {
		return databaseTransactionContext.transaction(async tx => {
			const locked = await this.lockDraft(tx, input.itemId, input.expectedVersionNo)
			if (!isAssetRoleCompatible(prepared.mediaType, input.role)) {
				throw new ORPCError("BAD_REQUEST", { message: "Asset type is not valid for this role" })
			}
			await this.ensureRoleAvailable(tx, locked.current.id, input.role)
			const stored = await this.objectStore.putVerified(tx, prepared)
			const [asset] = await tx
				.insert(assets)
				.values({
					id: randomUUID(),
					contentItemId: locked.item.id,
					sha256: stored.sha256,
					byteLength: stored.byteLength,
					mediaType: stored.mediaType,
					version: 1,
					uploadedBy: actorId,
				})
				.returning()
			const target = await this.createSnapshot(tx, locked, actorId, {
				add: { assetId: asset!.id, role: input.role },
			})
			await this.auditService.record(
				{
					domain: "content",
					action: "content.asset.upload",
					actorId,
					targetType: "asset",
					targetId: asset!.id,
					oldValue: {
						sourceVersionId: locked.current.id,
						sourceVersionNo: locked.current.versionNo,
					},
					newValue: this.auditMetadata(asset!, input.role, target),
				},
				tx
			)
			return this.mutationOutput(tx, asset!, locked.item.id, target)
		})
	}

	async attach(
		input: AttachPisoCampAssetInput,
		actorId: string
	): Promise<PisoCampAssetMutationOutput> {
		return databaseTransactionContext.transaction(async tx => {
			const locked = await this.lockDraft(tx, input.itemId, input.expectedVersionNo)
			const asset = await this.activeAsset(tx, input.assetId, input.itemId)
			if (!isAssetRoleCompatible(asset.mediaType, input.role)) {
				throw new ORPCError("BAD_REQUEST", { message: "Asset type is not valid for this role" })
			}
			await this.ensureRoleAvailable(tx, locked.current.id, input.role)
			const target = await this.createSnapshot(tx, locked, actorId, {
				add: { assetId: asset.id, role: input.role },
			})
			await this.recordMutation(tx, "attach", actorId, asset, input.role, locked, target)
			return this.mutationOutput(tx, asset, locked.item.id, target)
		})
	}

	async detach(
		input: DetachPisoCampAssetInput,
		actorId: string
	): Promise<PisoCampAssetMutationOutput> {
		return databaseTransactionContext.transaction(async tx => {
			const locked = await this.lockDraft(tx, input.itemId, input.expectedVersionNo)
			const [pair] = await tx
				.select({ asset: assets })
				.from(versionAssets)
				.innerJoin(assets, eq(versionAssets.assetId, assets.id))
				.where(
					and(
						eq(versionAssets.contentItemId, input.itemId),
						eq(versionAssets.contentVersionId, locked.current.id),
						eq(versionAssets.assetId, input.assetId),
						eq(versionAssets.role, input.role)
					)
				)
			if (!pair) throw new ORPCError("NOT_FOUND", { message: "Attachment not found" })
			const target = await this.createSnapshot(tx, locked, actorId, { excludeRole: input.role })
			await this.recordMutation(tx, "detach", actorId, pair.asset, input.role, locked, target)
			return this.mutationOutput(tx, pair.asset, locked.item.id, target)
		})
	}

	async delete(
		input: DeletePisoCampAssetInput,
		actorId: string
	): Promise<PisoCampAssetMutationOutput> {
		return databaseTransactionContext.transaction(async tx => {
			const locked = await this.lockCurrent(tx, input.itemId)
			const [asset] = await tx
				.select()
				.from(assets)
				.where(and(eq(assets.id, input.assetId), eq(assets.contentItemId, input.itemId)))
				.for("update")
			if (!asset) throw new ORPCError("NOT_FOUND", { message: "Asset not found" })
			const published = await tx
				.select({ id: contentVersions.id })
				.from(versionAssets)
				.innerJoin(contentVersions, eq(versionAssets.contentVersionId, contentVersions.id))
				.where(and(eq(versionAssets.assetId, asset.id), eq(contentVersions.status, "published")))
				.limit(1)
			if (published.length) {
				throw new ORPCError("CONFLICT", { message: "Published content references this asset" })
			}
			if (asset.deletedAt) throw new ORPCError("CONFLICT", { message: "Asset is deleted" })
			this.validateDraft(locked, input.expectedVersionNo)
			const [attached] = await tx
				.select({ role: versionAssets.role })
				.from(versionAssets)
				.where(
					and(
						eq(versionAssets.contentVersionId, locked.current.id),
						eq(versionAssets.assetId, asset.id)
					)
				)
			const target = await this.createSnapshot(tx, locked, actorId, {
				excludeAssetId: asset.id,
			})
			const deletedAt = new Date()
			await tx.update(assets).set({ deletedAt, deletedBy: actorId }).where(eq(assets.id, asset.id))
			const deletedAsset = { ...asset, deletedAt, deletedBy: actorId }
			await this.auditService.record(
				{
					domain: "content",
					action: "content.asset.delete",
					actorId,
					targetType: "asset",
					targetId: asset.id,
					oldValue: {
						sourceVersionId: locked.current.id,
						sourceVersionNo: locked.current.versionNo,
					},
					newValue: {
						...this.auditMetadata(asset, attached?.role ?? null, target),
						deletedAt: deletedAt.toISOString(),
					},
				},
				tx
			)
			return this.mutationOutput(tx, deletedAsset, locked.item.id, target)
		})
	}

	private async lockDraft(
		tx: DatabaseTransaction,
		itemId: string,
		expectedVersionNo: number
	): Promise<LockedDraft> {
		const locked = await this.lockCurrent(tx, itemId)
		this.validateDraft(locked, expectedVersionNo)
		return locked
	}

	private async lockCurrent(tx: DatabaseTransaction, itemId: string): Promise<LockedDraft> {
		const [item] = await tx
			.select()
			.from(contentItems)
			.where(eq(contentItems.id, itemId))
			.for("update")
		if (!item) throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
		if (!item.currentWorkingVersionId) {
			throw new ORPCError("CONFLICT", { message: "Content item has no working version" })
		}
		const [current] = await tx
			.select()
			.from(contentVersions)
			.where(
				and(
					eq(contentVersions.id, item.currentWorkingVersionId),
					eq(contentVersions.itemId, item.id)
				)
			)
			.for("update")
		if (!current) throw new ORPCError("CONFLICT", { message: "Working version is missing" })
		return { item, current }
	}

	private validateDraft(locked: LockedDraft, expectedVersionNo: number): void {
		if (locked.item.status !== "draft" || locked.current.status !== "draft") {
			throw new ORPCError("CONFLICT", { message: "Only draft content can manage assets" })
		}
		if (locked.current.versionNo !== expectedVersionNo) {
			throw new ORPCError("CONFLICT", { message: "Content was edited by another user" })
		}
	}

	private async activeAsset(tx: DatabaseTransaction, assetId: string, itemId: string) {
		const [asset] = await tx
			.select()
			.from(assets)
			.where(and(eq(assets.id, assetId), eq(assets.contentItemId, itemId)))
			.for("update")
		if (!asset) throw new ORPCError("NOT_FOUND", { message: "Asset not found" })
		if (asset.deletedAt) throw new ORPCError("CONFLICT", { message: "Asset is deleted" })
		return asset
	}

	private async ensureRoleAvailable(
		tx: DatabaseTransaction,
		versionId: string,
		role: PisoCampAssetRole
	) {
		const existing = await tx
			.select({ assetId: versionAssets.assetId })
			.from(versionAssets)
			.where(and(eq(versionAssets.contentVersionId, versionId), eq(versionAssets.role, role)))
			.limit(1)
		if (existing.length) {
			throw new ORPCError("CONFLICT", { message: "An asset is already attached in this role" })
		}
	}

	private async createSnapshot(
		tx: DatabaseTransaction,
		locked: LockedDraft,
		actorId: string,
		change: {
			excludeRole?: PisoCampAssetRole
			excludeAssetId?: string
			add?: { assetId: string; role: PisoCampAssetRole }
		}
	) {
		const id = randomUUID()
		const versionNo = locked.current.versionNo + 1
		await tx.insert(contentVersions).values({
			id,
			itemId: locked.item.id,
			versionNo,
			parentVersionId: locked.current.id,
			status: "draft",
			contentType: locked.current.contentType,
			title: locked.current.title,
			summary: locked.current.summary,
			body: locked.current.body,
			seriesCode: locked.current.seriesCode,
			denominationCode: locked.current.denominationCode,
			primaryUrl: locked.current.primaryUrl,
			createdBy: actorId,
		})
		const links = await tx
			.select()
			.from(relatedLinks)
			.where(eq(relatedLinks.contentVersionId, locked.current.id))
			.orderBy(asc(relatedLinks.position), asc(relatedLinks.id))
		if (links.length) {
			await tx.insert(relatedLinks).values(
				links.map(link => ({
					id: randomUUID(),
					contentVersionId: id,
					position: link.position,
					kind: link.kind,
					label: link.label,
					externalUrl: link.externalUrl,
					internalRoute: link.internalRoute,
					targetContentItemId: link.targetContentItemId,
				}))
			)
		}
		await copyVersionAssets(tx, {
			contentItemId: locked.item.id,
			sourceVersionId: locked.current.id,
			targetVersionId: id,
			...change,
		})
		await tx
			.update(contentItems)
			.set({ currentWorkingVersionId: id, lastEditedBy: actorId, updatedAt: new Date() })
			.where(eq(contentItems.id, locked.item.id))
		return { id, versionNo }
	}

	private async recordMutation(
		tx: DatabaseTransaction,
		action: "attach" | "detach",
		actorId: string,
		asset: typeof assets.$inferSelect,
		role: PisoCampAssetRole,
		locked: LockedDraft,
		target: { id: string; versionNo: number }
	) {
		await this.auditService.record(
			{
				domain: "content",
				action: `content.asset.${action}`,
				actorId,
				targetType: "asset",
				targetId: asset.id,
				oldValue: {
					sourceVersionId: locked.current.id,
					sourceVersionNo: locked.current.versionNo,
				},
				newValue: this.auditMetadata(asset, role, target),
			},
			tx
		)
	}

	private auditMetadata(
		asset: typeof assets.$inferSelect,
		role: PisoCampAssetRole | null,
		target: { id: string; versionNo: number }
	) {
		return {
			assetId: asset.id,
			itemId: asset.contentItemId,
			role,
			sha256: asset.sha256,
			mediaType: asset.mediaType,
			byteLength: asset.byteLength,
			assetVersion: asset.version,
			targetVersionId: target.id,
			targetVersionNo: target.versionNo,
		}
	}

	private async mutationOutput(
		tx: DatabaseTransaction,
		asset: typeof assets.$inferSelect,
		itemId: string,
		target: { id: string; versionNo: number }
	): Promise<PisoCampAssetMutationOutput> {
		return {
			asset: mapAsset(asset),
			currentVersionId: target.id,
			currentVersionNo: target.versionNo,
			attachments: await selectVersionAssets(tx, itemId, target.id),
		}
	}
}
