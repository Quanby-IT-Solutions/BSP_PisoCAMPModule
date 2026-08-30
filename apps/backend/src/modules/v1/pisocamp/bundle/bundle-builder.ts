import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"

import {
	PisoCampBundleEnvelopeSchema,
	PisoCampBundleManifestSchema,
	type PisoCampBundleManifestEntry,
} from "@repo/contracts"

import type { ContentWorkflowService } from "../content/content-workflow.service"
import { PostgresBundleObjectStore } from "./bundle-object-store"
import { renderPublishedContentResources } from "./bundle-renderer"
import { BundleLeaseLostError, BundleRepository } from "./bundle-repository"
import type { BundleSigner } from "./bundle-signer"

export interface BundleBuilderConfig {
	leaseSeconds: number
	batchSize: number
	owner: string
}

function entriesMatch(
	left: readonly PisoCampBundleManifestEntry[],
	right: readonly (Omit<PisoCampBundleManifestEntry, "contentItemId" | "contentVersionId"> & {
		contentItemId: string | null
		contentVersionId: string | null
	})[]
): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

@Injectable()
export class BundleBuilder {
	constructor(
		private readonly repository: BundleRepository,
		private readonly objectStore: PostgresBundleObjectStore,
		private readonly signer: BundleSigner | null,
		private readonly workflow: ContentWorkflowService,
		private readonly config: BundleBuilderConfig,
		private readonly clock: () => Date = () => new Date()
	) {}

	async buildNextBundle(
		reason: string
	): Promise<{ outcome: "built" | "unchanged" | "lease_lost"; bundleVersion: string | null }> {
		void reason
		const claimedAt = this.clock()
		const claims = await this.repository.claimDue({
			owner: this.config.owner,
			now: claimedAt,
			leaseSeconds: this.config.leaseSeconds,
			batchSize: this.config.batchSize,
		})
		try {
			const current = await this.repository.getCurrentReady()
			if (current && claims.length === 0) {
				return { outcome: "unchanged", bundleVersion: current.version.toString() }
			}
			return await this.repository.withBuildLock(async transaction => {
				const now = this.clock()
				if (!(await this.repository.claimsOwned(transaction, claims, this.config.owner, now))) {
					throw new BundleLeaseLostError()
				}
				const lockedCurrent = await this.repository.getCurrentReady(transaction)
				const candidates = await this.workflow.listPublishedBundleCandidates(transaction)
				const resources = renderPublishedContentResources(candidates)
				const entries: PisoCampBundleManifestEntry[] = resources.map(resource => ({
					logicalId: resource.logicalId,
					kind: resource.kind,
					delivery: resource.delivery,
					mediaType: resource.mediaType,
					byteLength: resource.byteLength,
					sha256: resource.sha256,
					downloadPath: `/pisocamp/bundle/resources/${resource.sha256}`,
					contentItemId: resource.contentItemId,
					contentVersionId: resource.contentVersionId,
				}))

				if (lockedCurrent) {
					const existing = await this.repository.getReadyEntries(transaction, lockedCurrent.id)
					if (entriesMatch(entries, existing)) {
						await this.repository.completeClaims(
							transaction,
							claims,
							lockedCurrent.id,
							this.config.owner,
							now
						)
						return { outcome: "unchanged", bundleVersion: lockedCurrent.version.toString() }
					}
				}

				if (!this.signer) {
					throw Object.assign(new Error("bundle_signing_config_invalid"), {
						code: "bundle_signing_config_invalid",
					})
				}
				const bundle = await this.repository.createBuildingBundle(transaction, now)
				for (const resource of resources) {
					await this.objectStore.putVerified(transaction, resource)
				}

				const manifest = PisoCampBundleManifestSchema.parse({
					schemaVersion: 1,
					bundleVersion: bundle.version.toString(),
					generatedAt: now.toISOString(),
					minimumClientSchemaVersion: 1,
					entries,
				})
				const payloadBytes = Buffer.from(JSON.stringify(manifest), "utf8")
				const signed = await this.signer.sign(payloadBytes)
				const envelope = PisoCampBundleEnvelopeSchema.parse({
					schemaVersion: 1,
					algorithm: signed.algorithm,
					keyId: signed.keyId,
					payload: payloadBytes.toString("base64url"),
					signature: signed.signature,
				})
				await this.repository.insertManifestEntries(transaction, bundle.id, entries)
				const totals = await this.repository.reconcileBundle(transaction, bundle.id)
				const expectedCoreBytes = entries.reduce(
					(total, entry) => total + (entry.delivery === "core" ? entry.byteLength : 0),
					0
				)
				if (totals.entryCount !== entries.length || totals.coreByteLength !== expectedCoreBytes) {
					throw Object.assign(new Error("bundle_reconciliation_failed"), {
						code: "bundle_reconciliation_failed",
					})
				}
				const promoted = await this.repository.promote(transaction, {
					bundleId: bundle.id,
					bundleVersion: bundle.version,
					envelope,
					manifestSha256: createHash("sha256").update(payloadBytes).digest("hex"),
					entryCount: totals.entryCount,
					coreByteLength: totals.coreByteLength,
					claims,
					owner: this.config.owner,
					now,
				})
				if (!promoted) {
					throw Object.assign(new Error("bundle_promotion_stale"), {
						code: "bundle_promotion_stale",
					})
				}
				return { outcome: "built", bundleVersion: bundle.version.toString() }
			})
		} catch (error) {
			if (error instanceof BundleLeaseLostError) {
				return { outcome: "lease_lost", bundleVersion: null }
			}
			await Promise.allSettled([
				this.repository.failOwnedClaims(claims, this.config.owner, this.clock(), error),
				this.repository.recordFailedBundle(this.clock(), error),
			])
			throw error
		}
	}
}
