import { createPrivateKey, createPublicKey, randomUUID, verify } from "node:crypto"
import { and, count, eq, sql } from "drizzle-orm"

import {
	contentBundleBlobs,
	contentBundleChannels,
	contentBundleManifestEntries,
	contentBundleRebuildRequests,
	contentBundles,
	contentItems,
	contentVersions,
	relatedLinks,
	users,
} from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import {
	PisoCampBundleEnvelopeSchema,
	PisoCampBundleManifestSchema,
} from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/bundle.schema"
import fixture from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json"
import type { ContentDatabase } from "../content/content-mapping"
import { ContentWorkflowService } from "../content/content-workflow.service"
import { BundleBuilder } from "./bundle-builder"
import { PostgresBundleObjectStore } from "./bundle-object-store"
import { BundleRepository } from "./bundle-repository"
import { Ed25519BundleSigner, type BundleSigner } from "./bundle-signer"

jest.mock("@repo/contracts", () =>
	jest.requireActual(
		"../../../../../../../packages/contracts/src/modules/v1/pisocamp/bundle.schema"
	)
)
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {},
}))

const describePostgres = process.env.PISOCAMP_BUNDLE_TEST_DATABASE_URL ? describe : describe.skip
const ACTOR_ID = "ce1-task3-builder-actor"

jest.setTimeout(60_000)

function stageAfterFirstQuery(
	database: ContentDatabase,
	afterFirstQuery: () => Promise<void>
): ContentDatabase {
	let completedQueries = 0
	const wrapQuery = (query: object): object =>
		new Proxy(query, {
			get(target, property) {
				if (property === "then") {
					const then = Reflect.get(target, property, target) as (
						onFulfilled?: (value: unknown) => unknown,
						onRejected?: (error: unknown) => unknown
					) => Promise<unknown>
					return (
						onFulfilled?: (value: unknown) => unknown,
						onRejected?: (error: unknown) => unknown
					) =>
						then.call(
							target,
							async value => {
								completedQueries += 1
								if (completedQueries === 1) await afterFirstQuery()
								return onFulfilled ? onFulfilled(value) : value
							},
							onRejected
						)
				}
				const value = Reflect.get(target, property, target) as unknown
				if (typeof value !== "function") return value
				return (...args: unknown[]) => wrapQuery(value.apply(target, args) as object)
			},
		})

	return new Proxy(database, {
		get(target, property) {
			const value = Reflect.get(target, property, target) as unknown
			if (typeof value !== "function") return value
			if (property !== "select") return value.bind(target)
			return (...args: unknown[]) => wrapQuery(value.apply(target, args) as object)
		},
	})
}

describePostgres("BundleBuilder PostgreSQL integration", () => {
	const repository = new BundleRepository()
	const objectStore = new PostgresBundleObjectStore()
	const workflow = new ContentWorkflowService({} as never)
	const signer = new Ed25519BundleSigner(
		fixture.keyId,
		createPrivateKey(fixture.privateKeyPkcs8Pem)
			.export({ format: "der", type: "pkcs8" })
			.toString("base64")
	)
	const buildWith = (input: {
		owner: string
		selectedRepository?: BundleRepository
		selectedStore?: PostgresBundleObjectStore
		selectedSigner?: BundleSigner
		leaseSeconds?: number
		batchSize?: number
	}) =>
		new BundleBuilder(
			input.selectedRepository ?? repository,
			input.selectedStore ?? objectStore,
			input.selectedSigner ?? signer,
			workflow,
			{
				owner: input.owner,
				leaseSeconds: input.leaseSeconds ?? 120,
				batchSize: input.batchSize ?? 1,
			},
			() => new Date()
		)
	const build = (owner: string, selectedSigner: BundleSigner = signer) =>
		buildWith({ owner, selectedSigner })

	async function insertPublished(title: string, enqueue = true) {
		const itemId = randomUUID()
		const versionId = randomUUID()
		const now = new Date("2026-08-27T00:00:00.000Z")
		await db.insert(contentItems).values({
			id: itemId,
			contentType: "advisory",
			status: "published",
			bundlePending: enqueue,
			createdBy: ACTOR_ID,
			lastEditedBy: ACTOR_ID,
		})
		await db.insert(contentVersions).values({
			id: versionId,
			itemId,
			versionNo: 1,
			status: "published",
			contentType: "advisory",
			title,
			summary: "Public summary",
			body: "Public body",
			createdBy: ACTOR_ID,
			approvedBy: ACTOR_ID,
			approvedAt: now,
			publishedBy: ACTOR_ID,
			publishedAt: now,
			transitionAction: "publish",
		})
		await db
			.update(contentItems)
			.set({ currentWorkingVersionId: versionId, currentPublishedVersionId: versionId })
			.where(eq(contentItems.id, itemId))
		if (enqueue) {
			await db.insert(contentBundleRebuildRequests).values({
				itemId,
				publishedVersionId: versionId,
				availableAt: new Date("2026-08-26T00:00:00.000Z"),
			})
		}
		return { itemId, versionId }
	}

	async function currentEnvelope() {
		const [row] = await db
			.select({
				bundleId: contentBundles.id,
				version: contentBundles.version,
				state: contentBundles.state,
				payload: contentBundles.manifestPayload,
				manifestSha256: contentBundles.manifestSha256,
				algorithm: contentBundles.algorithm,
				keyId: contentBundles.keyId,
				signature: contentBundles.signature,
			})
			.from(contentBundleChannels)
			.innerJoin(contentBundles, eq(contentBundleChannels.currentBundleId, contentBundles.id))
			.where(eq(contentBundleChannels.id, "primary"))
		const envelope = PisoCampBundleEnvelopeSchema.parse({
			schemaVersion: 1,
			algorithm: row!.algorithm,
			keyId: row!.keyId,
			payload: row!.payload,
			signature: row!.signature,
		})
		return {
			...row!,
			envelope,
			manifest: PisoCampBundleManifestSchema.parse(
				JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"))
			),
		}
	}

	async function moveRequestDue(requestId: string): Promise<void> {
		await db.execute(
			sql.raw(
				'alter table "content_bundle_rebuild_request" disable trigger "content_bundle_rebuild_request_immutable_trigger"'
			)
		)
		try {
			await db
				.update(contentBundleRebuildRequests)
				.set({ availableAt: new Date("2026-08-26T00:00:00.000Z") })
				.where(eq(contentBundleRebuildRequests.id, requestId))
		} finally {
			await db.execute(
				sql.raw(
					'alter table "content_bundle_rebuild_request" enable trigger "content_bundle_rebuild_request_immutable_trigger"'
				)
			)
		}
	}

	async function installPromotionFault(): Promise<void> {
		await db.execute(
			sql.raw(`
			create sequence ce1_task3_fix2_promotion_probe_sequence minvalue 0 start with 0;
			create function ce1_task3_fix2_probe_ready_transition() returns trigger as $$
			begin
				if old.state = 'building' and new.state = 'ready' then
					perform nextval('ce1_task3_fix2_promotion_probe_sequence');
				end if;
				return new;
			end;
			$$ language plpgsql;
			create trigger ce1_task3_fix2_ready_probe_trigger
				after update of state on content_bundle
				for each row execute function ce1_task3_fix2_probe_ready_transition();
			create function ce1_task3_fix2_fail_channel_advance() returns trigger as $$
			begin
				raise exception 'ce1_task3_promotion_fault' using errcode = 'P0001';
			end;
			$$ language plpgsql;
			create trigger zz_ce1_task3_fix2_channel_fault_trigger
				before update of current_bundle_id on content_bundle_channel
				for each row execute function ce1_task3_fix2_fail_channel_advance();
		`)
		)
	}

	async function removePromotionFault(): Promise<void> {
		await db.execute(
			sql.raw(`
			drop trigger if exists zz_ce1_task3_fix2_channel_fault_trigger on content_bundle_channel;
			drop trigger if exists ce1_task3_fix2_ready_probe_trigger on content_bundle;
			drop function if exists ce1_task3_fix2_fail_channel_advance();
			drop function if exists ce1_task3_fix2_probe_ready_transition();
			drop sequence if exists ce1_task3_fix2_promotion_probe_sequence;
		`)
		)
	}

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		expect(process.env.DATABASE_URL).toBe(process.env.PISOCAMP_BUNDLE_TEST_DATABASE_URL)
		await db.execute(sql`select 1`)
	})

	beforeEach(async () => {
		await removePromotionFault()
		await db.execute(sql`
			truncate table content_bundle_manifest_entry, content_bundle_rebuild_request,
				content_bundle_channel, content_bundle_blob, content_bundle, related_link,
				content_item, content_version, users restart identity cascade
		`)
		await db.insert(users).values({
			id: ACTOR_ID,
			name: "CE1 actor",
			email: "ce1-task3@example.test",
			emailVerified: true,
		})
	})

	afterAll(async () => {
		await removePromotionFault()
		await db.$client.end()
	})

	it("bootstraps an empty signed bundle and takes the unchanged no-version path", async () => {
		const builder = build("ce1-builder-empty")
		expect(await builder.buildNextBundle("bootstrap")).toEqual({
			outcome: "built",
			bundleVersion: "1",
		})
		const first = await currentEnvelope()
		expect(first.state).toBe("ready")
		expect(first.manifest.entries).toEqual([])
		expect(await builder.buildNextBundle("interval")).toEqual({
			outcome: "unchanged",
			bundleVersion: "1",
		})
		const [bundles] = await db.select({ value: count() }).from(contentBundles)
		expect(bundles!.value).toBe(1)
	})

	it("builds only the exact current published pointer and reconciles stored totals", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		const published = await insertPublished("Published title")
		await insertPublished("Not current", false).then(async stale => {
			await db
				.update(contentItems)
				.set({ status: "approved", currentPublishedVersionId: null })
				.where(eq(contentItems.id, stale.itemId))
		})

		expect(await build("ce1-builder-changed").buildNextBundle("manual")).toEqual({
			outcome: "built",
			bundleVersion: "2",
		})
		const current = await currentEnvelope()
		expect(current.manifest.entries).toHaveLength(1)
		expect(current.manifest.entries[0]).toMatchObject({
			logicalId: `content.${published.itemId}`,
			contentItemId: published.itemId,
			contentVersionId: published.versionId,
		})
		const [entry] = await db
			.select()
			.from(contentBundleManifestEntries)
			.where(eq(contentBundleManifestEntries.bundleId, current.bundleId))
		const [blob] = await db
			.select()
			.from(contentBundleBlobs)
			.where(eq(contentBundleBlobs.sha256, entry!.sha256))
		expect(entry!.byteLength).toBe(blob!.byteLength)
		expect(blob!.body.toString("utf8")).not.toMatch(
			/ce1-task3-builder-actor|approvedBy|publishedBy/
		)
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, published.itemId))
		expect(item!.bundlePending).toBe(false)
	})

	it("keeps a newer publication actionable and builds it on the next run", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		const published = await insertPublished("Older publication")
		const nextVersionId = randomUUID()
		const now = new Date("2026-08-27T00:01:00.000Z")
		await db.insert(contentVersions).values({
			id: nextVersionId,
			itemId: published.itemId,
			versionNo: 2,
			parentVersionId: published.versionId,
			status: "published",
			contentType: "advisory",
			title: "New publication",
			summary: "New summary",
			body: "New body",
			createdBy: ACTOR_ID,
			approvedBy: ACTOR_ID,
			approvedAt: now,
			publishedBy: ACTOR_ID,
			publishedAt: now,
			transitionAction: "publish",
		})
		let advanced = false
		const racingStore = {
			putVerified: async (...args: Parameters<PostgresBundleObjectStore["putVerified"]>) => {
				const stored = await objectStore.putVerified(...args)
				if (!advanced) {
					advanced = true
					await db
						.update(contentItems)
						.set({ currentPublishedVersionId: nextVersionId, bundlePending: true })
						.where(eq(contentItems.id, published.itemId))
					await db.insert(contentBundleRebuildRequests).values({
						itemId: published.itemId,
						publishedVersionId: nextVersionId,
						availableAt: new Date("2026-08-26T00:00:00.000Z"),
					})
				}
				return stored
			},
		}
		const builder = new BundleBuilder(
			repository,
			racingStore as PostgresBundleObjectStore,
			signer,
			workflow,
			{ owner: "ce1-builder-race", leaseSeconds: 120, batchSize: 1 },
			() => new Date()
		)

		const raced = await builder.buildNextBundle("manual")
		expect(raced.outcome).toBe("built")
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, published.itemId))
		expect(item).toMatchObject({ currentPublishedVersionId: nextVersionId, bundlePending: true })
		const racedEnvelope = await currentEnvelope()
		expect(racedEnvelope.manifest.entries).toEqual([
			expect.objectContaining({ contentVersionId: nextVersionId }),
		])

		expect(await build("ce1-builder-race-next").buildNextBundle("manual")).toEqual({
			outcome: "unchanged",
			bundleVersion: raced.bundleVersion,
		})
		const next = await currentEnvelope()
		expect(next.manifest.entries).toEqual([
			expect.objectContaining({
				contentItemId: published.itemId,
				contentVersionId: nextVersionId,
			}),
		])
		const [updatedItem] = await db
			.select()
			.from(contentItems)
			.where(eq(contentItems.id, published.itemId))
		const requests = await db
			.select()
			.from(contentBundleRebuildRequests)
			.orderBy(contentBundleRebuildRequests.createdAt)
		expect(updatedItem!.bundlePending).toBe(false)
		expect(requests.map(request => request.state)).toEqual(["completed", "completed"])
	})

	it("recovers only a bounded ordered expired set without waiting for a locked row", async () => {
		const publications = await Promise.all(
			["Expired 1", "Expired 2", "Expired 3", "Expired 4"].map(title =>
				insertPublished(title, false)
			)
		)
		const requestIds: string[] = []
		for (let index = 0; index < publications.length; index += 1) {
			const publication = publications[index]!
			const createdAt = new Date(Date.UTC(2026, 7, 25, 0, index, 0))
			const [request] = await db
				.insert(contentBundleRebuildRequests)
				.values({
					itemId: publication.itemId,
					publishedVersionId: publication.versionId,
					availableAt: createdAt,
					createdAt,
				})
				.returning({ id: contentBundleRebuildRequests.id })
			requestIds.push(request!.id)
		}
		await db.execute(
			sql.raw(
				'alter table "content_bundle_rebuild_request" disable trigger "content_bundle_rebuild_request_immutable_trigger"'
			)
		)
		try {
			for (let index = 0; index < requestIds.length; index += 1) {
				const lastAttemptAt = new Date(Date.UTC(2026, 7, 25, 1, index, 0))
				await db
					.update(contentBundleRebuildRequests)
					.set({
						state: "processing",
						attemptCount: 1,
						lastAttemptAt,
						leaseOwner: "expired-owner",
						leaseExpiresAt: new Date(lastAttemptAt.getTime() + 1_000),
					})
					.where(eq(contentBundleRebuildRequests.id, requestIds[index]!))
			}
		} finally {
			await db.execute(
				sql.raw(
					'alter table "content_bundle_rebuild_request" enable trigger "content_bundle_rebuild_request_immutable_trigger"'
				)
			)
		}

		const lockClient = await db.$client.connect()
		await lockClient.query("begin")
		await lockClient.query(
			"select id from content_bundle_rebuild_request where id = $1 for update",
			[requestIds[0]]
		)
		const claimPromise = repository.claimDue({
			owner: "bounded-owner",
			now: new Date(),
			leaseSeconds: 120,
			batchSize: 2,
		})
		try {
			const claims = await Promise.race([
				claimPromise,
				new Promise<"blocked">(resolve => setTimeout(() => resolve("blocked"), 2_000)),
			])
			expect(claims).not.toBe("blocked")
			expect(claims).toHaveLength(2)
			if (claims !== "blocked") {
				expect(new Set(claims.map(claim => claim.id))).toEqual(
					new Set([requestIds[1], requestIds[2]])
				)
			}
		} finally {
			await lockClient.query("rollback")
			lockClient.release()
			await claimPromise
		}
		const rows = await db
			.select({
				state: contentBundleRebuildRequests.state,
				owner: contentBundleRebuildRequests.leaseOwner,
			})
			.from(contentBundleRebuildRequests)
		expect(rows.filter(row => row.owner === "bounded-owner")).toHaveLength(2)
		expect(
			rows.filter(row => row.state === "processing" && row.owner === "expired-owner")
		).toHaveLength(2)
	})

	it("reads candidate rows and related links from one repeatable-read snapshot", async () => {
		const published = await insertPublished("Snapshot publication", false)
		let isolation = ""
		const candidates = await repository.withBuildLock(async transaction => {
			const setting = await transaction.execute<{ isolation: string }>(
				sql`select current_setting('transaction_isolation') as isolation`
			)
			isolation = setting.rows[0]!.isolation
			const staged = stageAfterFirstQuery(transaction, async () => {
				await db.insert(relatedLinks).values({
					contentVersionId: published.versionId,
					position: 0,
					kind: "external",
					label: "Committed between reads",
					externalUrl: "https://example.test/snapshot",
				})
			})
			return workflow.listPublishedBundleCandidates(staged)
		})
		expect(isolation).toBe("repeatable read")
		expect(candidates[0]!.relatedLinks).toEqual([])
		expect(await db.select().from(relatedLinks)).toHaveLength(1)
	})

	it("recovers an expired claim and rejects stale lease ownership", async () => {
		const published = await insertPublished("Expired lease", false)
		const [request] = await db
			.insert(contentBundleRebuildRequests)
			.values({
				itemId: published.itemId,
				publishedVersionId: published.versionId,
				availableAt: new Date("2026-08-25T00:00:00.000Z"),
			})
			.returning({ id: contentBundleRebuildRequests.id })
		await repository.claimDue({
			owner: "expired-owner",
			now: new Date(),
			leaseSeconds: 30,
			batchSize: 1,
		})
		await db.execute(
			sql.raw(
				'alter table "content_bundle_rebuild_request" disable trigger "content_bundle_rebuild_request_immutable_trigger"'
			)
		)
		try {
			await db
				.update(contentBundleRebuildRequests)
				.set({
					createdAt: new Date("2026-08-25T00:00:00.000Z"),
					lastAttemptAt: new Date("2026-08-25T00:00:00.000Z"),
					leaseExpiresAt: new Date("2026-08-25T00:01:00.000Z"),
				})
				.where(eq(contentBundleRebuildRequests.id, request!.id))
		} finally {
			await db.execute(
				sql.raw(
					'alter table "content_bundle_rebuild_request" enable trigger "content_bundle_rebuild_request_immutable_trigger"'
				)
			)
		}

		const claims = await repository.claimDue({
			owner: "recovery-owner",
			now: new Date(),
			leaseSeconds: 120,
			batchSize: 1,
		})
		expect(claims).toEqual([
			expect.objectContaining({
				itemId: published.itemId,
				publishedVersionId: published.versionId,
				attemptCount: 2,
			}),
		])
		expect(await repository.claimsOwned(db, claims, "stale-owner", new Date())).toBe(false)
		expect(await repository.claimsOwned(db, claims, "recovery-owner", new Date())).toBe(true)
	})

	it("rolls back failed signing, retries above the failed version gap, and never points at failed", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		await insertPublished("Retry publication")
		const failingSigner: BundleSigner = {
			sign: async () => {
				throw Object.assign(new Error("secret title"), { code: "signing_failed" })
			},
		}
		await expect(
			build("ce1-builder-fail", failingSigner).buildNextBundle("manual")
		).rejects.toThrow()
		const afterFailure = await currentEnvelope()
		expect(afterFailure.version).toBe(1n)
		const failed = await db.select().from(contentBundles).where(eq(contentBundles.state, "failed"))
		expect(failed).toHaveLength(1)
		const [request] = await db.select().from(contentBundleRebuildRequests)
		expect(request).toMatchObject({ state: "failed", lastError: "signing_failed" })
		await new Promise(resolve =>
			setTimeout(resolve, Math.max(0, request!.availableAt.getTime() - Date.now() + 100))
		)
		const retried = await build("ce1-builder-retry").buildNextBundle("manual")
		expect(retried.outcome).toBe("built")
		expect(BigInt(retried.bundleVersion!)).toBeGreaterThan(failed[0]!.version)
		const current = await currentEnvelope()
		expect(current.state).toBe("ready")
		expect(current.version).toBe(BigInt(retried.bundleVersion!))
	})

	it("rolls back object writes, masks unknown codes, and retries above the failed gap", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		await insertPublished("Object store failure")
		const sentinel = "customer_secret_value"
		const failingStore = {
			putVerified: async (...args: Parameters<PostgresBundleObjectStore["putVerified"]>) => {
				await objectStore.putVerified(...args)
				throw Object.assign(new Error(`private body ${sentinel}`), { code: sentinel })
			},
		}

		await expect(
			buildWith({
				owner: "ce1-builder-store-fail",
				selectedStore: failingStore as unknown as PostgresBundleObjectStore,
			}).buildNextBundle("manual")
		).rejects.toMatchObject({ code: sentinel })
		const afterFailure = await currentEnvelope()
		expect(afterFailure.version).toBe(1n)
		const failed = await db.select().from(contentBundles).where(eq(contentBundles.state, "failed"))
		expect(failed).toHaveLength(1)
		expect(failed[0]!.failureCode).toBe("bundle_build_failed")
		const [request] = await db.select().from(contentBundleRebuildRequests)
		expect(request).toMatchObject({ state: "failed", lastError: "bundle_build_failed" })
		expect(
			request!.availableAt.getTime() - request!.lastAttemptAt!.getTime()
		).toBeGreaterThanOrEqual(30_000)
		expect(request!.lastError).not.toContain(sentinel)
		expect(await db.select().from(contentBundleBlobs)).toEqual([])
		expect(await db.select().from(contentBundleManifestEntries)).toEqual([])
		expect(
			await db.select().from(contentBundles).where(eq(contentBundles.state, "building"))
		).toEqual([])

		await moveRequestDue(request!.id)
		const retried = await build("ce1-builder-store-retry").buildNextBundle("manual")
		expect(retried.outcome).toBe("built")
		expect(BigInt(retried.bundleVersion!)).toBeGreaterThan(failed[0]!.version)
		expect((await currentEnvelope()).version).toBe(BigInt(retried.bundleVersion!))
	})

	it("rolls back a promotion failure and retries above the failed version gap", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		await insertPublished("Promotion failure")
		const beforeFailure = await currentEnvelope()
		await installPromotionFault()

		let realReadyMutationRan = false
		try {
			await expect(build("ce1-builder-promotion-fail").buildNextBundle("manual")).rejects.toThrow()
			const probe = await db.execute<{ isCalled: boolean }>(
				sql`select is_called as "isCalled" from ce1_task3_fix2_promotion_probe_sequence`
			)
			realReadyMutationRan = probe.rows[0]!.isCalled
		} finally {
			await removePromotionFault()
		}
		expect(realReadyMutationRan).toBe(true)
		const installedFaultTriggers = await db.execute<{ value: string }>(sql`
			select count(*)::text as value
			from pg_trigger
			where tgname in (
				'ce1_task3_fix2_ready_probe_trigger',
				'zz_ce1_task3_fix2_channel_fault_trigger'
			)
		`)
		expect(installedFaultTriggers.rows[0]!.value).toBe("0")
		const afterFailure = await currentEnvelope()
		expect(afterFailure.bundleId).toBe(beforeFailure.bundleId)
		expect(afterFailure.version).toBe(beforeFailure.version)
		expect(afterFailure.state).toBe("ready")
		const failed = await db.select().from(contentBundles).where(eq(contentBundles.state, "failed"))
		expect(failed).toHaveLength(1)
		const [request] = await db.select().from(contentBundleRebuildRequests)
		expect(request).toMatchObject({ state: "failed", lastError: "bundle_build_failed" })
		expect(
			request!.availableAt.getTime() - request!.lastAttemptAt!.getTime()
		).toBeGreaterThanOrEqual(30_000)
		expect(await db.select().from(contentBundleBlobs)).toEqual([])
		expect(await db.select().from(contentBundleManifestEntries)).toEqual([])
		expect(
			await db.select().from(contentBundles).where(eq(contentBundles.state, "building"))
		).toEqual([])

		await moveRequestDue(request!.id)
		const retried = await build("ce1-builder-promotion-retry").buildNextBundle("manual")
		expect(retried.outcome).toBe("built")
		expect(BigInt(retried.bundleVersion!)).toBeGreaterThan(failed[0]!.version)
		const afterRetry = await currentEnvelope()
		expect(afterRetry.state).toBe("ready")
		expect(afterRetry.version).toBe(BigInt(retried.bundleVersion!))
		expect(afterRetry.bundleId).not.toBe(beforeFailure.bundleId)
	})

	it("returns lease_lost through the builder and recovers the expired request on retry", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		await insertPublished("Lease loss")
		const delayedRepository = new BundleRepository()
		const lock = delayedRepository.withBuildLock.bind(delayedRepository)
		delayedRepository.withBuildLock = work =>
			lock(async transaction => {
				await new Promise(resolve => setTimeout(resolve, 1_100))
				return work(transaction)
			})
		const lost = await buildWith({
			owner: "ce1-builder-lease-loss",
			selectedRepository: delayedRepository,
			leaseSeconds: 1,
		}).buildNextBundle("manual")
		expect(lost).toEqual({ outcome: "lease_lost", bundleVersion: null })
		expect((await currentEnvelope()).version).toBe(1n)
		const [expired] = await db.select().from(contentBundleRebuildRequests)
		expect(expired).toMatchObject({
			state: "processing",
			leaseOwner: "ce1-builder-lease-loss",
		})
		expect(expired!.leaseExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now())
		expect(
			await db.select().from(contentBundles).where(eq(contentBundles.state, "building"))
		).toEqual([])

		const retried = await build("ce1-builder-lease-retry").buildNextBundle("manual")
		expect(retried.outcome).toBe("built")
		const [completed] = await db.select().from(contentBundleRebuildRequests)
		expect(completed).toMatchObject({ state: "completed", attemptCount: 2 })
		expect((await currentEnvelope()).version).toBe(BigInt(retried.bundleVersion!))
	})

	it("completes an older claim against a valid newer bundle built from the fresher snapshot", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		const older = await insertPublished("Older publication")
		const pausedRepository = new BundleRepository()
		const withBuildLock = pausedRepository.withBuildLock.bind(pausedRepository)
		let reachedBeforeLock!: () => void
		let releaseBeforeLock!: () => void
		const beforeLock = new Promise<void>(resolve => (reachedBeforeLock = resolve))
		const release = new Promise<void>(resolve => (releaseBeforeLock = resolve))
		pausedRepository.withBuildLock = async work => {
			reachedBeforeLock()
			await release
			return withBuildLock(work)
		}
		const olderBuild = buildWith({
			owner: "ce1-builder-older",
			selectedRepository: pausedRepository,
		}).buildNextBundle("manual")
		await beforeLock

		const [claimedOlder] = await db
			.select()
			.from(contentBundleRebuildRequests)
			.where(eq(contentBundleRebuildRequests.publishedVersionId, older.versionId))
		expect(claimedOlder).toMatchObject({
			state: "processing",
			leaseOwner: "ce1-builder-older",
		})

		const newerVersionId = randomUUID()
		const publishedAt = new Date("2026-08-28T00:00:00.000Z")
		await db.insert(contentVersions).values({
			id: newerVersionId,
			itemId: older.itemId,
			versionNo: 2,
			parentVersionId: older.versionId,
			status: "published",
			contentType: "advisory",
			title: "Newer publication",
			summary: "Newer public summary",
			body: "Newer public body",
			createdBy: ACTOR_ID,
			approvedBy: ACTOR_ID,
			approvedAt: publishedAt,
			publishedBy: ACTOR_ID,
			publishedAt,
			transitionAction: "publish",
		})
		await db
			.update(contentItems)
			.set({
				currentWorkingVersionId: newerVersionId,
				currentPublishedVersionId: newerVersionId,
				bundlePending: true,
			})
			.where(eq(contentItems.id, older.itemId))
		await db.insert(contentBundleRebuildRequests).values({
			itemId: older.itemId,
			publishedVersionId: newerVersionId,
			availableAt: new Date("2026-08-27T00:00:00.000Z"),
		})

		const newerEvidence = await (async () => {
			try {
				const newerOutcome = await build("ce1-builder-newer").buildNextBundle("manual")
				const validNewer = await currentEnvelope()
				const validNewerEntries = await db
					.select()
					.from(contentBundleManifestEntries)
					.where(eq(contentBundleManifestEntries.bundleId, validNewer.bundleId))
				return { newerOutcome, validNewer, validNewerEntries }
			} catch (error) {
				releaseBeforeLock()
				await Promise.allSettled([olderBuild])
				throw error
			}
		})()
		releaseBeforeLock()
		const olderOutcome = await olderBuild
		const { newerOutcome, validNewer, validNewerEntries } = newerEvidence
		const afterOlder = await currentEnvelope()

		expect(newerOutcome).toEqual({
			outcome: "built",
			bundleVersion: validNewer.version.toString(),
		})
		expect(validNewer.state).toBe("ready")
		expect(validNewer.manifest.bundleVersion).toBe(validNewer.version.toString())
		expect(validNewer.manifest.entries).toEqual([
			expect.objectContaining({
				contentItemId: older.itemId,
				contentVersionId: newerVersionId,
			}),
		])
		expect(validNewerEntries).toEqual([
			expect.objectContaining({
				bundleId: validNewer.bundleId,
				contentItemId: older.itemId,
				contentVersionId: newerVersionId,
			}),
		])
		expect(
			verify(
				null,
				Buffer.from(validNewer.envelope.payload, "base64url"),
				createPublicKey(fixture.publicKeySpkiPem),
				Buffer.from(validNewer.envelope.signature, "base64url")
			)
		).toBe(true)
		expect(olderOutcome).toEqual({
			outcome: "unchanged",
			bundleVersion: validNewer.version.toString(),
		})
		expect(afterOlder.bundleId).toBe(validNewer.bundleId)
		expect(afterOlder.version).toBe(validNewer.version)
		const requests = await db.select().from(contentBundleRebuildRequests)
		expect(requests).toHaveLength(2)
		expect(requests).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					publishedVersionId: older.versionId,
					state: "completed",
					processedBundleId: validNewer.bundleId,
				}),
				expect.objectContaining({
					publishedVersionId: newerVersionId,
					state: "completed",
					processedBundleId: validNewer.bundleId,
				}),
			])
		)
		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, older.itemId))
		expect(item).toMatchObject({
			currentPublishedVersionId: newerVersionId,
			bundlePending: false,
		})
		expect(await db.select().from(contentBundles)).toHaveLength(2)
		expect(
			await db
				.select()
				.from(contentBundles)
				.where(sql`${contentBundles.state} <> 'ready'`)
		).toEqual([])
	})

	it("serializes two builders and removes unpublished content on the next requested build", async () => {
		await build("ce1-builder-bootstrap").buildNextBundle("bootstrap")
		const first = await insertPublished("First")
		const second = await insertPublished("Second")
		const outcomes = await Promise.all([
			build("ce1-builder-concurrent-a").buildNextBundle("interval"),
			build("ce1-builder-concurrent-b").buildNextBundle("interval"),
		])
		expect(outcomes.map(result => result.outcome).sort()).toEqual(["built", "unchanged"])
		const built = await currentEnvelope()
		expect(built.manifest.entries).toHaveLength(2)

		const removalVersionId = randomUUID()
		const removalAt = new Date("2026-08-27T00:02:00.000Z")
		await db.insert(contentVersions).values({
			id: removalVersionId,
			itemId: first.itemId,
			versionNo: 2,
			parentVersionId: first.versionId,
			status: "published",
			contentType: "advisory",
			title: "Removal request source",
			summary: "Removal summary",
			body: "Removal body",
			createdBy: ACTOR_ID,
			approvedBy: ACTOR_ID,
			approvedAt: removalAt,
			publishedBy: ACTOR_ID,
			publishedAt: removalAt,
			transitionAction: "publish",
		})
		await db
			.update(contentItems)
			.set({
				status: "published",
				currentPublishedVersionId: removalVersionId,
				currentWorkingVersionId: removalVersionId,
				bundlePending: true,
			})
			.where(eq(contentItems.id, first.itemId))
		await db.insert(contentBundleRebuildRequests).values({
			itemId: first.itemId,
			publishedVersionId: removalVersionId,
			availableAt: new Date("2026-08-26T00:00:00.000Z"),
		})
		await db
			.update(contentItems)
			.set({ status: "unpublished", currentPublishedVersionId: null, bundlePending: true })
			.where(eq(contentItems.id, first.itemId))

		const removed = await build("ce1-builder-removal").buildNextBundle("manual")
		expect(removed.outcome).toBe("built")
		const current = await currentEnvelope()
		expect(current.manifest.entries.map(entry => entry.contentItemId)).toEqual([second.itemId])
		expect(current.manifest.entries.map(entry => entry.contentItemId)).not.toContain(first.itemId)
		const [badPointers] = await db
			.select({ value: count() })
			.from(contentBundleChannels)
			.innerJoin(contentBundles, eq(contentBundleChannels.currentBundleId, contentBundles.id))
			.where(and(eq(contentBundleChannels.id, "primary"), sql`${contentBundles.state} <> 'ready'`))
		expect(badPointers!.value).toBe(0)
	})
})
