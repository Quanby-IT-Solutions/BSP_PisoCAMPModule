import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"

import { contentBundleBlobs } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

import type { ContentDatabase } from "../content/content-mapping"

type BundleMediaType = "application/json" | "image/png" | "image/jpeg" | "image/webp"
const MAX_BUNDLE_OBJECT_BYTES = 5_242_880
const BUNDLE_MEDIA_TYPES = new Set<BundleMediaType>([
	"application/json",
	"image/png",
	"image/jpeg",
	"image/webp",
])

export class BundleObjectCorruptionError extends Error {
	readonly code: string

	constructor(code = "store_corruption") {
		super(code)
		this.name = "BundleObjectCorruptionError"
		this.code = code
	}
}

@Injectable()
export class PostgresBundleObjectStore {
	async readPublicByDigest(sha256: string) {
		return this.readByDigest(db, sha256)
	}

	async putVerified(
		database: ContentDatabase,
		input: { bytes: Uint8Array; mediaType: BundleMediaType; sha256: string }
	): Promise<{ sha256: string; byteLength: number; mediaType: BundleMediaType }> {
		const bytes = Buffer.from(input.bytes)
		const digest = createHash("sha256").update(bytes).digest("hex")
		if (digest !== input.sha256) throw new BundleObjectCorruptionError("store_digest_mismatch")
		if (bytes.byteLength < 1 || bytes.byteLength > MAX_BUNDLE_OBJECT_BYTES) {
			throw new BundleObjectCorruptionError("store_size_invalid")
		}

		await database
			.insert(contentBundleBlobs)
			.values({
				sha256: digest,
				byteLength: bytes.byteLength,
				mediaType: input.mediaType,
				body: bytes,
			})
			.onConflictDoNothing()

		const stored = await this.readByDigest(database, digest)
		if (
			!stored ||
			stored.byteLength !== bytes.byteLength ||
			stored.mediaType !== input.mediaType ||
			!stored.bytes.equals(bytes)
		) {
			throw new BundleObjectCorruptionError()
		}
		return { sha256: digest, byteLength: bytes.byteLength, mediaType: input.mediaType }
	}

	async readByDigest(
		database: ContentDatabase,
		sha256: string
	): Promise<{
		sha256: string
		byteLength: number
		mediaType: BundleMediaType
		bytes: Buffer
	} | null> {
		if (!/^[a-f0-9]{64}$/.test(sha256)) return null
		const [row] = await database
			.select()
			.from(contentBundleBlobs)
			.where(eq(contentBundleBlobs.sha256, sha256))
		if (!row) return null

		const bytes = Buffer.from(row.body)
		const digest = createHash("sha256").update(bytes).digest("hex")
		if (
			digest !== row.sha256 ||
			bytes.byteLength !== row.byteLength ||
			row.byteLength < 1 ||
			row.byteLength > MAX_BUNDLE_OBJECT_BYTES ||
			!BUNDLE_MEDIA_TYPES.has(row.mediaType)
		) {
			throw new BundleObjectCorruptionError()
		}
		return {
			sha256: row.sha256,
			byteLength: row.byteLength,
			mediaType: row.mediaType,
			bytes,
		}
	}
}
