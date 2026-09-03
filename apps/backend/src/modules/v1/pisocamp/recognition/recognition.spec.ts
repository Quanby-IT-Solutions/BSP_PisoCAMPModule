import { createHash, randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import type { PublishRecognitionModelInput } from "@repo/contracts/pisocamp-recognition"
import {
	auditLog,
	contentBundleBlobs,
	contentBundleRebuildRequests,
	recognitionModels,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PostgresBundleObjectStore } from "../bundle/bundle-object-store"
import { readActiveRecognitionModel } from "./active-recognition-model"
import { RecognitionModelError, RecognitionService } from "./recognition.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
}))

const ADMIN = "dr4-admin"

const CLASSES = [
	{ classId: 0, outcome: "denomination" as const, label: "Twenty pesos", denominationCode: "PHP20" },
	{ classId: 1, outcome: "demonetized" as const, label: "New Design Series" },
	{ classId: 2, outcome: "foreign" as const },
]

function weights(marker = 1): Buffer {
	return Buffer.from(new Uint8Array(64).fill(marker))
}

function publishInput(
	version: string,
	overrides: Partial<PublishRecognitionModelInput> = {}
): PublishRecognitionModelInput {
	return {
		// The file itself never reaches the service — the controller hands over
		// the bytes — so a placeholder here keeps the shape honest without
		// pretending a File exists in Node.
		file: undefined as never,
		version,
		classes: CLASSES,
		thresholds: { confidence: 0.85, dwellSeconds: 8 },
		requestId: randomUUID(),
		...overrides,
	}
}

/**
 * DR-4. Publishing the weights every device runs on people's money.
 *
 * The rules asserted here are the ones that decide what a phone tells somebody
 * holding a banknote: which model is live, which thresholds go with it, and
 * whether a change actually reaches anybody.
 */
describe("DR-4 recognition model publication", () => {
	let service: RecognitionService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table recognition_model, content_bundle_rebuild_request,
				content_bundle_manifest_entry, content_bundle, content_bundle_blob,
				audit_log, sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values({
			id: ADMIN,
			name: "DR-4 administrator",
			email: "dr4-admin@test.local",
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})
		service = new RecognitionService(new PostgresBundleObjectStore(), new AuditService())
	})

	afterAll(async () => {
		await db.$client.end()
	})

	describe("AC1 — a published model is stored and delivered", () => {
		it("stores the weights by digest and records the model against them", async () => {
			const bytes = weights()
			const { model } = await service.publish(publishInput("2026.09.1"), bytes, ADMIN)

			const digest = createHash("sha256").update(bytes).digest("hex")
			expect(model).toMatchObject({
				version: "2026.09.1",
				status: "active",
				classCount: 3,
				weightsSha256: digest,
				weightsByteLength: bytes.byteLength,
			})

			// Stored where every other bundle object lives, so the model a device
			// verifies against the signed manifest is this one.
			const [blob] = await db
				.select()
				.from(contentBundleBlobs)
				.where(eq(contentBundleBlobs.sha256, digest))
			expect(blob).toMatchObject({
				mediaType: "application/octet-stream",
				byteLength: bytes.byteLength,
			})
		})

		it("hands the bundle the live model, with the thresholds approved for it", async () => {
			await service.publish(publishInput("2026.09.1"), weights(), ADMIN)

			const active = await readActiveRecognitionModel()
			expect(active).toMatchObject({
				version: "2026.09.1",
				thresholds: { confidence: 0.85, dwellSeconds: 8 },
			})
			expect(active?.classes).toHaveLength(3)
		})

		it("marks the bundle due, or a published model would reach nobody", async () => {
			await service.publish(publishInput("2026.09.1"), weights(), ADMIN)

			const requests = await db.select().from(contentBundleRebuildRequests)
			expect(requests).toHaveLength(1)
			// No content version caused it, and the request says so rather than
			// borrowing an unrelated item's identity.
			expect(requests[0]).toMatchObject({
				reason: "recognition_model",
				itemId: null,
				publishedVersionId: null,
				state: "pending",
			})
		})

		it("retires the previous model, so exactly one is ever live", async () => {
			await service.publish(publishInput("2026.09.1"), weights(1), ADMIN)
			await service.publish(publishInput("2026.09.2"), weights(2), ADMIN)

			const rows = await db
				.select()
				.from(recognitionModels)
				.orderBy(recognitionModels.version)
			expect(rows.map(row => [row.version, row.status])).toEqual([
				["2026.09.1", "retired"],
				["2026.09.2", "active"],
			])
			expect(rows[0]!.retiredAt).not.toBeNull()
			expect(await readActiveRecognitionModel()).toMatchObject({ version: "2026.09.2" })
		})

		it("refuses to publish a version that already exists", async () => {
			await service.publish(publishInput("2026.09.1"), weights(), ADMIN)

			// A version is how a figure is traced back to the weights that
			// produced it; reusing one would make two different models
			// indistinguishable in every report.
			await expect(
				service.publish(publishInput("2026.09.1"), weights(3), ADMIN)
			).rejects.toMatchObject({ code: "recognition_model_version_exists" })
			expect(await db.select().from(recognitionModels)).toHaveLength(1)
		})

		it("audits the publication and what it replaced", async () => {
			await service.publish(publishInput("2026.09.1"), weights(1), ADMIN)
			await service.publish(publishInput("2026.09.2"), weights(2), ADMIN)

			const rows = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.action, "recognition.model.publish"))
			expect(rows).toHaveLength(2)
			expect(rows[1]).toMatchObject({
				actorId: ADMIN,
				targetType: "recognition_model",
				targetId: "2026.09.2",
				oldValue: { retiredVersion: "2026.09.1" },
			})
			expect(rows[1]!.newValue).toMatchObject({
				thresholds: { confidence: 0.85, dwellSeconds: 8 },
				classCount: 3,
			})
		})
	})

	/** Rebuild requests are append-only, so a change is a count that grew. */
	async function rebuildRequestCount(): Promise<number> {
		const rows = await db.select().from(contentBundleRebuildRequests)
		return rows.length
	}

	describe("AC3 — threshold edits are audited and reach devices", () => {
		it("records the change from and to, and marks the bundle due", async () => {
			await service.publish(publishInput("2026.09.1"), weights(), ADMIN)
			const before = await rebuildRequestCount()

			const { model } = await service.updateThresholds(
				{
					version: "2026.09.1",
					thresholds: { confidence: 0.92, dwellSeconds: 12 },
					requestId: randomUUID(),
				},
				ADMIN
			)

			expect(model.thresholds).toEqual({ confidence: 0.92, dwellSeconds: 12 })
			expect(await readActiveRecognitionModel()).toMatchObject({
				thresholds: { confidence: 0.92, dwellSeconds: 12 },
			})
			// "Takes effect on the next bundle sync" is only true if a sync is
			// actually due.
			expect(await rebuildRequestCount()).toBe(before + 1)

			const [entry] = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.action, "recognition.thresholds.update"))
			expect(entry).toMatchObject({
				actorId: ADMIN,
				targetId: "2026.09.1",
				oldValue: { confidence: 0.85, dwellSeconds: 8 },
				newValue: { confidence: 0.92, dwellSeconds: 12 },
			})
		})

		it("does not rebuild the bundle for a model nobody is running", async () => {
			await service.publish(publishInput("2026.09.1"), weights(1), ADMIN)
			await service.publish(publishInput("2026.09.2"), weights(2), ADMIN)
			const before = await rebuildRequestCount()

			await service.updateThresholds(
				{
					version: "2026.09.1",
					thresholds: { confidence: 0.9, dwellSeconds: 5 },
					requestId: randomUUID(),
				},
				ADMIN
			)

			// Correcting a retired model's record changes nothing on any device,
			// and a rebuild that carries no change is a sync every device pays for.
			expect(await rebuildRequestCount()).toBe(before)
			const [entry] = await db
				.select()
				.from(auditLog)
				.where(eq(auditLog.action, "recognition.thresholds.update"))
			expect(entry).toBeDefined()
		})

		it("refuses to edit a model that was never published", async () => {
			await expect(
				service.updateThresholds(
					{
						version: "never.published",
						thresholds: { confidence: 0.9, dwellSeconds: 5 },
						requestId: randomUUID(),
					},
					ADMIN
				)
			).rejects.toBeInstanceOf(RecognitionModelError)
		})
	})

	it("lists what has been published, newest first", async () => {
		await service.publish(publishInput("2026.09.1"), weights(1), ADMIN)
		await service.publish(publishInput("2026.09.2"), weights(2), ADMIN)

		const { models } = await service.list()
		expect(models.map(model => model.version)).toEqual(["2026.09.2", "2026.09.1"])
		expect(models[0]).toMatchObject({ status: "active" })
		expect(models[1]).toMatchObject({ status: "retired" })
	})

	it("refuses a second live model at the database, not only in code", async () => {
		await service.publish(publishInput("2026.09.1"), weights(), ADMIN)

		// Two live models would mean the bundle had to choose, and whichever it
		// chose would be a coin toss over which weights every device runs.
		await expect(
			db.insert(recognitionModels).values({
				id: randomUUID(),
				version: "2026.09.9",
				status: "active",
				classes: CLASSES,
				confidenceThreshold: 0.8,
				dwellSeconds: 8,
				weightsSha256: createHash("sha256").update(weights(9)).digest("hex"),
				weightsByteLength: 64,
				publishedBy: ADMIN,
			})
		).rejects.toMatchObject({ cause: { constraint: "recognition_model_single_active_idx" } })
	})
})
