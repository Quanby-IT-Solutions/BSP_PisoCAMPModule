import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"

import {
	PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES,
	PISO_CAMP_ASSET_MEDIA_TYPES,
	type PisoCampAssetMediaType,
} from "@repo/contracts/pisocamp-assets"
import { assetObjects } from "@repo/db/schema"

import type { ContentDatabase } from "../content/content-mapping"
import type { PreparedAssetUpload } from "./asset-file-policy"

const MEDIA_TYPES = new Set<PisoCampAssetMediaType>(PISO_CAMP_ASSET_MEDIA_TYPES)

export interface StoredAssetObject {
	sha256: string
	byteLength: number
	mediaType: PisoCampAssetMediaType
	bytes: Buffer
}

export class AssetObjectCorruptionError extends Error {
	readonly code: "store_corruption" | "store_digest_mismatch"

	constructor(code: AssetObjectCorruptionError["code"] = "store_corruption") {
		super(code)
		this.name = "AssetObjectCorruptionError"
		this.code = code
	}
}

@Injectable()
export class PostgresAssetObjectStore {
	async putVerified(
		database: ContentDatabase,
		input: PreparedAssetUpload
	): Promise<StoredAssetObject> {
		const bytes = Buffer.from(input.bytes)
		const digest = createHash("sha256").update(bytes).digest("hex")
		if (digest !== input.sha256) throw new AssetObjectCorruptionError("store_digest_mismatch")
		if (
			bytes.length !== input.byteLength ||
			bytes.length < 1 ||
			bytes.length > PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES[input.mediaType]
		) {
			throw new AssetObjectCorruptionError()
		}

		await database
			.insert(assetObjects)
			.values({
				sha256: digest,
				byteLength: bytes.length,
				mediaType: input.mediaType,
				body: bytes,
			})
			.onConflictDoNothing()

		const stored = await this.readByDigest(database, digest)
		if (
			!stored ||
			stored.byteLength !== bytes.length ||
			stored.mediaType !== input.mediaType ||
			!stored.bytes.equals(bytes)
		) {
			throw new AssetObjectCorruptionError()
		}
		return stored
	}

	async readByDigest(database: ContentDatabase, sha256: string): Promise<StoredAssetObject | null> {
		if (!/^[a-f0-9]{64}$/.test(sha256)) return null
		const [row] = await database.select().from(assetObjects).where(eq(assetObjects.sha256, sha256))
		if (!row) return null

		const mediaType = row.mediaType
		const bytes = Buffer.from(row.body)
		if (
			!MEDIA_TYPES.has(mediaType) ||
			bytes.length !== row.byteLength ||
			bytes.length < 1 ||
			bytes.length > PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES[mediaType] ||
			createHash("sha256").update(bytes).digest("hex") !== row.sha256
		) {
			throw new AssetObjectCorruptionError()
		}
		return {
			sha256: row.sha256,
			byteLength: row.byteLength,
			mediaType,
			bytes,
		}
	}
}
