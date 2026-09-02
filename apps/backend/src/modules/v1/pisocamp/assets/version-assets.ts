import { ORPCError } from "@orpc/server"
import { and, asc, eq, isNull, sql } from "drizzle-orm"

import type { PisoCampAsset, PisoCampAssetRole, PisoCampVersionAsset } from "@repo/contracts"
import { assets, versionAssets } from "@repo/db/schema"

import type { DatabaseTransaction } from "@/common/database/database-transaction.context"

import type { ContentDatabase } from "../content/content-mapping"

const roleOrder = sql`case ${versionAssets.role}
	when 'obverse' then 1 when 'reverse' then 2 when 'edge' then 3
	when 'texture' then 4 when 'audio' then 5 when 'animation' then 6 end`

export function isAssetRoleCompatible(mediaType: string, role: PisoCampAssetRole): boolean {
	if (mediaType.startsWith("image/"))
		return ["obverse", "reverse", "edge", "texture"].includes(role)
	if (mediaType.startsWith("audio/")) return role === "audio"
	return role === "animation"
}

export function mapAsset(row: typeof assets.$inferSelect): PisoCampAsset {
	return {
		id: row.id,
		contentItemId: row.contentItemId,
		sha256: row.sha256,
		mediaType: row.mediaType,
		byteLength: row.byteLength,
		version: row.version,
		createdAt: row.createdAt.toISOString(),
	}
}

export async function selectVersionAssets(
	database: ContentDatabase,
	contentItemId: string,
	contentVersionId: string
): Promise<PisoCampVersionAsset[]> {
	const rows = await database
		.select({ role: versionAssets.role, asset: assets })
		.from(versionAssets)
		.innerJoin(assets, eq(versionAssets.assetId, assets.id))
		.where(
			and(
				eq(versionAssets.contentItemId, contentItemId),
				eq(versionAssets.contentVersionId, contentVersionId)
			)
		)
		.orderBy(roleOrder, asc(versionAssets.assetId))
	return rows.map(row => ({ role: row.role, asset: mapAsset(row.asset) }))
}

export async function copyVersionAssets(
	tx: DatabaseTransaction,
	input: {
		contentItemId: string
		sourceVersionId: string
		targetVersionId: string
		excludeRole?: PisoCampAssetRole
		excludeAssetId?: string
		add?: { assetId: string; role: PisoCampAssetRole }
	}
): Promise<void> {
	const source = await tx
		.select({ assetId: versionAssets.assetId, role: versionAssets.role })
		.from(versionAssets)
		.where(
			and(
				eq(versionAssets.contentItemId, input.contentItemId),
				eq(versionAssets.contentVersionId, input.sourceVersionId)
			)
		)
		.orderBy(roleOrder, asc(versionAssets.assetId))
	const retained = source.filter(
		row => row.role !== input.excludeRole && row.assetId !== input.excludeAssetId
	)

	if (input.add) {
		const [asset] = await tx
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.id, input.add.assetId),
					eq(assets.contentItemId, input.contentItemId),
					isNull(assets.deletedAt)
				)
			)
		if (!asset) throw new ORPCError("NOT_FOUND", { message: "Asset not found" })
		if (!isAssetRoleCompatible(asset.mediaType, input.add.role)) {
			throw new ORPCError("BAD_REQUEST", { message: "Asset type is not valid for this role" })
		}
		if (retained.some(row => row.role === input.add!.role)) {
			throw new ORPCError("CONFLICT", { message: "An asset is already attached in this role" })
		}
		retained.push(input.add)
	}

	if (!retained.length) return
	await tx.insert(versionAssets).values(
		retained.map(row => ({
			contentItemId: input.contentItemId,
			contentVersionId: input.targetVersionId,
			assetId: row.assetId,
			role: row.role,
		}))
	)
}
