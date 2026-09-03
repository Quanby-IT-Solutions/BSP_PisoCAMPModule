import { Injectable, Logger } from "@nestjs/common"
import { createHash, randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"

import {
	RecognitionModelClassListSchema,
	type PublishRecognitionModelInput,
	type RecognitionModelClass,
	type RecognitionModelSummary,
	type UpdateRecognitionThresholdsInput,
} from "@repo/contracts/pisocamp-recognition"
import { contentBundleRebuildRequests, recognitionModels } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { PostgresBundleObjectStore } from "../bundle/bundle-object-store"

export class RecognitionModelError extends Error {
	constructor(readonly code: string) {
		super(code)
		this.name = "RecognitionModelError"
	}
}

interface ModelRow {
	version: string
	status: "active" | "retired"
	classes: unknown
	confidenceThreshold: number
	dwellSeconds: number
	weightsSha256: string
	weightsByteLength: number
	publishedAt: Date
	retiredAt: Date | null
}

/**
 * DR-4. Publishing the model a device runs, and the thresholds it runs it with.
 *
 * Both halves are here because they belong together: the confidence that makes
 * a reading trustworthy was measured against one particular set of weights, and
 * carrying it separately is how a threshold approved for one model quietly
 * starts governing another.
 */
@Injectable()
export class RecognitionService {
	private readonly logger = new Logger(RecognitionService.name)

	constructor(
		private readonly objectStore: PostgresBundleObjectStore,
		private readonly auditService: AuditService
	) {}

	async list(): Promise<{ models: RecognitionModelSummary[] }> {
		const rows = await db
			.select()
			.from(recognitionModels)
			.orderBy(desc(recognitionModels.publishedAt))
			.limit(200)
		return { models: rows.map(row => this.summary(row as ModelRow)) }
	}

	async publish(
		input: PublishRecognitionModelInput,
		bytes: Buffer,
		actorId: string
	): Promise<{ model: RecognitionModelSummary }> {
		const sha256 = createHash("sha256").update(bytes).digest("hex")

		return db.transaction(async tx => {
			const [existing] = await tx
				.select({ version: recognitionModels.version })
				.from(recognitionModels)
				.where(eq(recognitionModels.version, input.version))
				.limit(1)
			if (existing) throw new RecognitionModelError("recognition_model_version_exists")

			// Stored by digest in the same place every other bundle object lives,
			// so the model a device verifies against the signed manifest is this
			// one and not a copy that drifted.
			await this.objectStore.putVerified(tx, {
				bytes,
				mediaType: "application/octet-stream",
				sha256,
			})

			const now = new Date()
			const [retired] = await tx
				.update(recognitionModels)
				.set({ status: "retired", retiredAt: now })
				.where(eq(recognitionModels.status, "active"))
				.returning({ version: recognitionModels.version })

			const [row] = await tx
				.insert(recognitionModels)
				.values({
					id: randomUUID(),
					version: input.version,
					status: "active",
					classes: input.classes,
					confidenceThreshold: input.thresholds.confidence,
					dwellSeconds: input.thresholds.dwellSeconds,
					weightsSha256: sha256,
					weightsByteLength: bytes.byteLength,
					publishedBy: actorId,
					publishedAt: now,
				})
				.returning()

			await this.enqueueRebuild(tx, now)
			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "recognition.model.publish",
					actorId,
					targetType: "recognition_model",
					targetId: input.version,
					// What it replaced, so a reader can follow which weights were
					// live when a figure was measured.
					oldValue: retired ? { retiredVersion: retired.version } : null,
					newValue: {
						version: input.version,
						thresholds: input.thresholds,
						classCount: input.classes.length,
						weightsSha256: sha256,
						weightsByteLength: bytes.byteLength,
					},
				},
				tx
			)
			this.logger.log(
				`recognition_model_published version=${input.version} classes=${input.classes.length}`
			)
			return { model: this.summary(row as unknown as ModelRow) }
		})
	}

	async updateThresholds(
		input: UpdateRecognitionThresholdsInput,
		actorId: string
	): Promise<{ model: RecognitionModelSummary }> {
		return db.transaction(async tx => {
			const [current] = await tx
				.select()
				.from(recognitionModels)
				.where(eq(recognitionModels.version, input.version))
				.limit(1)
			if (!current) throw new RecognitionModelError("recognition_model_not_found")

			const [row] = await tx
				.update(recognitionModels)
				.set({
					confidenceThreshold: input.thresholds.confidence,
					dwellSeconds: input.thresholds.dwellSeconds,
				})
				.where(eq(recognitionModels.version, input.version))
				.returning()

			const now = new Date()
			// Only a live model changes what devices do, and only then is there a
			// bundle to rebuild. Editing a retired model's record is a correction
			// to history, not a deployment.
			if (current.status === "active") await this.enqueueRebuild(tx, now)

			await this.auditService.record(
				{
					domain: "pisocamp",
					action: "recognition.thresholds.update",
					actorId,
					targetType: "recognition_model",
					targetId: input.version,
					oldValue: {
						confidence: current.confidenceThreshold,
						dwellSeconds: current.dwellSeconds,
					},
					newValue: input.thresholds,
				},
				tx
			)
			return { model: this.summary(row as unknown as ModelRow) }
		})
	}

	/**
	 * Marks the bundle due for a rebuild.
	 *
	 * Without this the builder sees no claim and reports the current bundle as
	 * unchanged, so a published model would sit in the database while every
	 * device kept running the old one.
	 */
	private async enqueueRebuild(tx: Parameters<AuditService["record"]>[1], now: Date) {
		await (tx ?? db).insert(contentBundleRebuildRequests).values({
			id: randomUUID(),
			itemId: null,
			publishedVersionId: null,
			reason: "recognition_model",
			state: "pending",
			availableAt: now,
			createdAt: now,
		})
	}

	private parseClasses(value: unknown): RecognitionModelClass[] {
		const parsed = RecognitionModelClassListSchema.safeParse(value)
		if (!parsed.success) {
			// Stored rows are written through the same schema, so this is a
			// corrupted row rather than a rejected input — and shipping a class
			// list nobody can vouch for is how a device names the wrong note.
			throw new RecognitionModelError("recognition_model_classes_corrupt")
		}
		return parsed.data
	}

	private summary(row: ModelRow): RecognitionModelSummary {
		return {
			version: row.version,
			status: row.status,
			classCount: this.parseClasses(row.classes).length,
			thresholds: {
				confidence: row.confidenceThreshold,
				dwellSeconds: row.dwellSeconds,
			},
			weightsSha256: row.weightsSha256,
			weightsByteLength: row.weightsByteLength,
			publishedAt: row.publishedAt.toISOString(),
			retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
		}
	}
}
