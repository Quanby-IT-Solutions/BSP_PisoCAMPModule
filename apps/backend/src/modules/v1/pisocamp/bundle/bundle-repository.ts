import { Injectable } from "@nestjs/common"
import { Buffer } from "node:buffer"
import { and, asc, count, eq, gt, inArray, lte, or, sql } from "drizzle-orm"

import type { PisoCampBundleEnvelope, PisoCampBundleManifestEntry } from "@repo/contracts"
import {
	contentBundleChannels,
	contentBundleManifestEntries,
	contentBundleRebuildRequests,
	contentBundles,
	contentItems,
} from "@repo/db/schema"

import type { DatabaseTransaction } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

import type { ContentDatabase } from "../content/content-mapping"

const BUILD_LOCK_NAMESPACE = 1_356_994_821
const BUILD_LOCK_KEY = 1
const MAX_SERIALIZATION_ATTEMPTS = 3
const MAX_MANIFEST_PAYLOAD_BYTES = 2_097_152
const SAFE_BUNDLE_ERROR_CODES = new Set([
	"bundle_allocation_failed",
	"bundle_build_failed",
	"bundle_lease_lost",
	"bundle_promotion_failed",
	"bundle_promotion_stale",
	"bundle_reconciliation_failed",
	"bundle_signing_config_invalid",
	"signing_failed",
	"store_corruption",
	"store_digest_mismatch",
	"store_size_invalid",
])

export interface ClaimedBundleRequest {
	id: string
	/** Null for a rebuild no content version caused, such as DR-4's model. */
	itemId: string | null
	publishedVersionId: string | null
	attemptCount: number
}

export interface CurrentReadyBundle {
	id: string
	version: bigint
}

export class BundleLeaseLostError extends Error {
	readonly code = "bundle_lease_lost"

	constructor() {
		super("bundle_lease_lost")
		this.name = "BundleLeaseLostError"
	}
}

export function calculateBundleRetryDelaySeconds(attemptCount: number): number {
	return Math.min(30 * 2 ** Math.max(0, attemptCount - 1), 3_600)
}

function isSerializationFailure(error: unknown): boolean {
	let current = error
	for (let depth = 0; depth < 4; depth += 1) {
		if (typeof current !== "object" || current === null) return false
		if ("code" in current && current.code === "40001") return true
		current = "cause" in current ? current.cause : null
	}
	return false
}

function isCanonicalBase64url(value: string, decodedLength?: number): boolean {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return false
	const bytes = Buffer.from(value, "base64url")
	return (
		bytes.toString("base64url") === value &&
		(decodedLength === undefined || bytes.length === decodedLength)
	)
}

@Injectable()
export class BundleRepository {
	async readCurrentReadyEnvelope(
		database: ContentDatabase = db
	): Promise<PisoCampBundleEnvelope | null> {
		const [row] = await database
			.select({
				schemaVersion: contentBundles.schemaVersion,
				algorithm: contentBundles.algorithm,
				keyId: contentBundles.keyId,
				payload: contentBundles.manifestPayload,
				signature: contentBundles.signature,
			})
			.from(contentBundleChannels)
			.innerJoin(contentBundles, eq(contentBundleChannels.currentBundleId, contentBundles.id))
			.where(and(eq(contentBundleChannels.id, "primary"), eq(contentBundles.state, "ready")))
			.limit(1)
		if (!row) return null

		if (
			row.schemaVersion !== 1 ||
			row.algorithm !== "Ed25519" ||
			typeof row.keyId !== "string" ||
			row.keyId.length > 64 ||
			!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(row.keyId) ||
			typeof row.payload !== "string" ||
			!isCanonicalBase64url(row.payload) ||
			Buffer.from(row.payload, "base64url").length > MAX_MANIFEST_PAYLOAD_BYTES ||
			typeof row.signature !== "string" ||
			!isCanonicalBase64url(row.signature, 64)
		) {
			return null
		}

		return {
			schemaVersion: 1,
			algorithm: "Ed25519",
			keyId: row.keyId,
			payload: row.payload,
			signature: row.signature,
		}
	}

	async claimDue(input: {
		owner: string
		now: Date
		leaseSeconds: number
		batchSize: number
	}): Promise<ClaimedBundleRequest[]> {
		return db.transaction(async tx => {
			await tx.execute(sql`
				with expired as (
					select ${contentBundleRebuildRequests.id}
					from ${contentBundleRebuildRequests}
					where ${contentBundleRebuildRequests.state} = 'processing'
						and ${contentBundleRebuildRequests.leaseExpiresAt} <= statement_timestamp()
					order by ${contentBundleRebuildRequests.leaseExpiresAt},
						${contentBundleRebuildRequests.createdAt},
						${contentBundleRebuildRequests.id}
					limit ${input.batchSize}
					for update skip locked
				)
				update ${contentBundleRebuildRequests} as request
				set state = 'pending',
					available_at = statement_timestamp(),
					last_error = 'lease_expired',
					lease_owner = null,
					lease_expires_at = null
				from expired
				where request.id = expired.id
			`)

			const due = await tx
				.select({ id: contentBundleRebuildRequests.id })
				.from(contentBundleRebuildRequests)
				.where(
					and(
						or(
							eq(contentBundleRebuildRequests.state, "pending"),
							eq(contentBundleRebuildRequests.state, "failed")
						),
						lte(contentBundleRebuildRequests.availableAt, sql`statement_timestamp()`)
					)
				)
				.orderBy(
					asc(contentBundleRebuildRequests.availableAt),
					asc(contentBundleRebuildRequests.createdAt)
				)
				.limit(input.batchSize)
				.for("update", { skipLocked: true })
			if (due.length === 0) return []

			return tx
				.update(contentBundleRebuildRequests)
				.set({
					state: "processing",
					attemptCount: sql`${contentBundleRebuildRequests.attemptCount} + 1`,
					lastAttemptAt: sql`statement_timestamp()`,
					leaseOwner: input.owner,
					leaseExpiresAt: sql`statement_timestamp() + (${input.leaseSeconds} * interval '1 second')`,
					lastError: null,
				})
				.where(
					inArray(
						contentBundleRebuildRequests.id,
						due.map(row => row.id)
					)
				)
				.returning({
					id: contentBundleRebuildRequests.id,
					itemId: contentBundleRebuildRequests.itemId,
					publishedVersionId: contentBundleRebuildRequests.publishedVersionId,
					attemptCount: contentBundleRebuildRequests.attemptCount,
				})
		})
	}

	async withBuildLock<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
		for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
			try {
				return await db.transaction(
					async tx => {
						await tx.execute(
							sql`select pg_advisory_xact_lock(${BUILD_LOCK_NAMESPACE}, ${BUILD_LOCK_KEY})`
						)
						return work(tx)
					},
					{ isolationLevel: "repeatable read" }
				)
			} catch (error) {
				if (attempt === MAX_SERIALIZATION_ATTEMPTS || !isSerializationFailure(error)) throw error
			}
		}
		throw new Error("bundle_build_failed")
	}

	async getCurrentReady(database: ContentDatabase = db): Promise<CurrentReadyBundle | null> {
		const [row] = await database
			.select({ id: contentBundles.id, version: contentBundles.version })
			.from(contentBundleChannels)
			.innerJoin(contentBundles, eq(contentBundleChannels.currentBundleId, contentBundles.id))
			.where(and(eq(contentBundleChannels.id, "primary"), eq(contentBundles.state, "ready")))
			.limit(1)
		return row ?? null
	}

	async claimsOwned(
		database: ContentDatabase,
		claims: readonly ClaimedBundleRequest[],
		owner: string,
		_now: Date
	): Promise<boolean> {
		if (claims.length === 0) return true
		const [row] = await database
			.select({ value: count() })
			.from(contentBundleRebuildRequests)
			.where(
				and(
					inArray(
						contentBundleRebuildRequests.id,
						claims.map(claim => claim.id)
					),
					eq(contentBundleRebuildRequests.state, "processing"),
					eq(contentBundleRebuildRequests.leaseOwner, owner),
					gt(contentBundleRebuildRequests.leaseExpiresAt, sql`statement_timestamp()`)
				)
			)
		return row?.value === claims.length
	}

	async getReadyEntries(database: ContentDatabase, bundleId: string) {
		return database
			.select({
				logicalId: contentBundleManifestEntries.logicalId,
				kind: contentBundleManifestEntries.kind,
				delivery: contentBundleManifestEntries.delivery,
				mediaType: contentBundleManifestEntries.mediaType,
				byteLength: contentBundleManifestEntries.byteLength,
				sha256: contentBundleManifestEntries.sha256,
				downloadPath: contentBundleManifestEntries.downloadPath,
				contentItemId: contentBundleManifestEntries.contentItemId,
				contentVersionId: contentBundleManifestEntries.contentVersionId,
			})
			.from(contentBundleManifestEntries)
			.where(eq(contentBundleManifestEntries.bundleId, bundleId))
			.orderBy(asc(contentBundleManifestEntries.position))
	}

	async createBuildingBundle(database: ContentDatabase, now: Date) {
		const [bundle] = await database
			.insert(contentBundles)
			.values({ state: "building", createdAt: now })
			.returning({ id: contentBundles.id, version: contentBundles.version })
		if (!bundle)
			throw Object.assign(new Error("bundle_allocation_failed"), {
				code: "bundle_allocation_failed",
			})
		return bundle
	}

	async insertManifestEntries(
		database: ContentDatabase,
		bundleId: string,
		entries: readonly PisoCampBundleManifestEntry[]
	): Promise<void> {
		if (entries.length === 0) return
		await database
			.insert(contentBundleManifestEntries)
			.values(entries.map((entry, position) => ({ ...entry, bundleId, position })))
	}

	async reconcileBundle(database: ContentDatabase, bundleId: string) {
		const [totals] = await database
			.select({
				entryCount: count(),
				coreByteLength: sql<number>`coalesce(sum(case when ${contentBundleManifestEntries.delivery} = 'core' then ${contentBundleManifestEntries.byteLength} else 0 end), 0)`,
			})
			.from(contentBundleManifestEntries)
			.where(eq(contentBundleManifestEntries.bundleId, bundleId))
		return {
			entryCount: Number(totals?.entryCount ?? 0),
			coreByteLength: Number(totals?.coreByteLength ?? 0),
		}
	}

	async completeClaims(
		database: ContentDatabase,
		claims: readonly ClaimedBundleRequest[],
		bundleId: string,
		owner: string,
		_now: Date
	): Promise<void> {
		if (claims.length === 0) return
		const completed = await database
			.update(contentBundleRebuildRequests)
			.set({
				state: "completed",
				processedBundleId: bundleId,
				processedAt: sql`statement_timestamp()`,
				leaseOwner: null,
				leaseExpiresAt: null,
				lastError: null,
			})
			.where(
				and(
					inArray(
						contentBundleRebuildRequests.id,
						claims.map(claim => claim.id)
					),
					eq(contentBundleRebuildRequests.state, "processing"),
					eq(contentBundleRebuildRequests.leaseOwner, owner),
					gt(contentBundleRebuildRequests.leaseExpiresAt, sql`statement_timestamp()`)
				)
			)
			.returning({ id: contentBundleRebuildRequests.id })
		if (completed.length !== claims.length) throw new BundleLeaseLostError()

		for (const claim of claims) {
			// A rebuild no content item caused has no item to clear the pending
			// flag on. Skipped rather than guarded further down, because a null
			// here would otherwise match every row with a null published version.
			if (!claim.itemId || !claim.publishedVersionId) continue
			await database
				.update(contentItems)
				.set({ bundlePending: false })
				.where(
					and(
						eq(contentItems.id, claim.itemId),
						eq(contentItems.currentPublishedVersionId, claim.publishedVersionId)
					)
				)
		}
	}

	async promote(
		database: ContentDatabase,
		input: {
			bundleId: string
			bundleVersion: bigint
			envelope: PisoCampBundleEnvelope
			manifestSha256: string
			entryCount: number
			coreByteLength: number
			claims: readonly ClaimedBundleRequest[]
			owner: string
			now: Date
		}
	): Promise<boolean> {
		const current = await this.getCurrentReady(database)
		if (current && current.version >= input.bundleVersion) return false
		const [ready] = await database
			.update(contentBundles)
			.set({
				state: "ready",
				manifestPayload: input.envelope.payload,
				manifestSha256: input.manifestSha256,
				algorithm: input.envelope.algorithm,
				keyId: input.envelope.keyId,
				signature: input.envelope.signature,
				entryCount: input.entryCount,
				coreByteLength: input.coreByteLength,
				readyAt: input.now,
			})
			.where(and(eq(contentBundles.id, input.bundleId), eq(contentBundles.state, "building")))
			.returning({ id: contentBundles.id })
		if (!ready) return false

		await database
			.insert(contentBundleChannels)
			.values({ id: "primary", currentBundleId: input.bundleId, updatedAt: input.now })
			.onConflictDoUpdate({
				target: contentBundleChannels.id,
				set: { currentBundleId: input.bundleId, updatedAt: input.now },
			})
		await this.completeClaims(database, input.claims, input.bundleId, input.owner, input.now)
		return true
	}

	async failOwnedClaims(
		claims: readonly ClaimedBundleRequest[],
		owner: string,
		now: Date,
		error: unknown
	): Promise<void> {
		if (claims.length === 0) return
		const errorCode = sanitizeBundleErrorCode(error)
		await db.transaction(async tx => {
			for (const claim of claims) {
				await tx
					.update(contentBundleRebuildRequests)
					.set({
						state: "failed",
						availableAt: sql`statement_timestamp() + (${calculateBundleRetryDelaySeconds(
							claim.attemptCount
						)} * interval '1 second')`,
						lastError: errorCode,
						leaseOwner: null,
						leaseExpiresAt: null,
					})
					.where(
						and(
							eq(contentBundleRebuildRequests.id, claim.id),
							eq(contentBundleRebuildRequests.state, "processing"),
							eq(contentBundleRebuildRequests.leaseOwner, owner),
							gt(contentBundleRebuildRequests.leaseExpiresAt, sql`statement_timestamp()`)
						)
					)
			}
		})
	}

	async recordFailedBundle(now: Date, error: unknown): Promise<void> {
		await db.insert(contentBundles).values({
			state: "failed",
			failureCode: sanitizeBundleErrorCode(error),
			createdAt: now,
			failedAt: now,
		})
	}
}

export function sanitizeBundleErrorCode(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error) {
		const normalized = typeof error.code === "string" ? error.code.toLowerCase() : ""
		if (SAFE_BUNDLE_ERROR_CODES.has(normalized)) return normalized
	}
	return "bundle_build_failed"
}
