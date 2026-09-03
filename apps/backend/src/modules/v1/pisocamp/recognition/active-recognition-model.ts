import { eq } from "drizzle-orm"

import { RecognitionModelClassListSchema } from "@repo/contracts/pisocamp-recognition"
import { recognitionModels } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

import type { ActiveRecognitionModel } from "../bundle/bundle-renderer"

/**
 * The model devices should be running, or null before one is published.
 *
 * A plain function rather than a service method so the bundle can read it
 * without importing the module that writes it: the builder's job is to carry
 * whatever is live, not to know how it got there.
 */
export async function readActiveRecognitionModel(): Promise<ActiveRecognitionModel | null> {
	const [row] = await db
		.select()
		.from(recognitionModels)
		.where(eq(recognitionModels.status, "active"))
		.limit(1)
	if (!row) return null

	const classes = RecognitionModelClassListSchema.safeParse(row.classes)
	if (!classes.success) {
		// A stored class list that no longer parses is not something to ship. A
		// device reading it would map class indexes onto the wrong meanings, and
		// the wrong meaning here is a wrong denomination spoken aloud.
		throw new Error("recognition_model_classes_corrupt")
	}

	return {
		version: row.version,
		thresholds: {
			confidence: row.confidenceThreshold,
			dwellSeconds: row.dwellSeconds,
		},
		classes: classes.data,
		weightsSha256: row.weightsSha256,
		weightsByteLength: row.weightsByteLength,
	}
}
