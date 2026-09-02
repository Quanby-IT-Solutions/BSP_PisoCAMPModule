import { describe, expect, it } from "vitest"

import { pisoCampContentContract } from "./content.contract.js"
import {
	ArchivePisoCampContentInputSchema,
	DeactivatePisoCampContentInputSchema,
	PISO_CAMP_CONTENT_WORKFLOW_ACTIONS,
	PisoCampContentReviewDetailSchema,
	SchedulePisoCampContentPublicationInputSchema,
	UnpublishPisoCampContentInputSchema,
} from "./content.schema.js"

const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"
const versionId = "fd21cf65-807b-4546-a7ed-e803d28568d2"
const requestId = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"

function detail(overrides: Record<string, unknown> = {}) {
	return {
		id: itemId,
		contentType: "advisory" as const,
		status: "unpublished" as const,
		publishAt: null,
		currentVersion: {
			id: versionId,
			versionNo: 5,
			status: "unpublished" as const,
			content: {
				contentType: "advisory" as const,
				title: "Handle banknotes with care",
				summary: "Approved advisory copy.",
				body: "Do not fold, staple or write on Philippine banknotes.",
			},
			relatedLinks: [],
			createdBy: { id: "approver", name: "Sam Rivera" },
			createdAt: "2026-09-01T05:00:00.000Z",
			transition: { action: "unpublish" as const, comments: null },
			approval: {
				actor: { id: "approver", name: "Sam Rivera" },
				at: "2026-09-01T03:00:00.000Z",
			},
			publication: {
				actor: { id: "approver", name: "Sam Rivera" },
				at: "2026-09-01T04:00:00.000Z",
			},
		},
		creator: { id: "editor", name: "Elena Editor" },
		lastEditor: { id: "editor", name: "Elena Editor" },
		createdAt: "2026-09-01T00:00:00.000Z",
		dateModified: "2026-09-01T05:00:00.000Z",
		...overrides,
	}
}

describe("CM-6 lifecycle contract", () => {
	it("registers the three withdrawal routes and the schedule route", () => {
		expect(pisoCampContentContract.unpublish["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/unpublish",
		})
		expect(pisoCampContentContract.deactivate["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/deactivate",
		})
		expect(pisoCampContentContract.archive["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/archive",
		})
		expect(pisoCampContentContract.schedule["~orpc"].route).toMatchObject({
			method: "PUT",
			path: "/admin/pisocamp/content/{itemId}/schedule",
		})
	})

	it("extends the workflow action list without disturbing the existing four", () => {
		expect(PISO_CAMP_CONTENT_WORKFLOW_ACTIONS).toEqual([
			"submit",
			"approve",
			"reject",
			"publish",
			"unpublish",
			"deactivate",
			"archive",
		])
	})

	it("accepts optional comments on every withdrawal and rejects unknown fields", () => {
		const base = { itemId, requestId, expectedVersionNo: 4 }
		for (const schema of [
			UnpublishPisoCampContentInputSchema,
			DeactivatePisoCampContentInputSchema,
			ArchivePisoCampContentInputSchema,
		]) {
			expect(schema.parse(base)).toEqual(base)
			expect(schema.parse({ ...base, comments: "Superseded." })).toEqual({
				...base,
				comments: "Superseded.",
			})
			expect(() => schema.parse({ ...base, extra: true })).toThrow()
			expect(() => schema.parse({ ...base, comments: "" })).toThrow()
		}
	})

	it("accepts a UTC instant or an explicit clear on the schedule input", () => {
		const base = { itemId, requestId, expectedVersionNo: 3 }

		expect(
			SchedulePisoCampContentPublicationInputSchema.parse({
				...base,
				publishAt: "2026-09-03T00:00:00.000Z",
			})
		).toEqual({ ...base, publishAt: "2026-09-03T00:00:00.000Z" })
		expect(
			SchedulePisoCampContentPublicationInputSchema.parse({ ...base, publishAt: null })
		).toEqual({ ...base, publishAt: null })
		expect(() =>
			SchedulePisoCampContentPublicationInputSchema.parse({
				...base,
				publishAt: "2026-09-03T08:00:00+08:00",
			})
		).toThrow()
		expect(() => SchedulePisoCampContentPublicationInputSchema.parse(base)).toThrow()
	})

	it("describes a withdrawn version as keeping its approval and publication provenance", () => {
		expect(PisoCampContentReviewDetailSchema.parse(detail())).toEqual(detail())
		expect(() =>
			PisoCampContentReviewDetailSchema.parse(
				detail({
					currentVersion: { ...detail().currentVersion, publication: null },
				})
			)
		).toThrow()
	})

	it("allows a scheduled publication only on approved content", () => {
		const approved = detail({
			status: "approved" as const,
			publishAt: "2026-09-03T00:00:00.000Z",
			currentVersion: {
				...detail().currentVersion,
				status: "approved" as const,
				transition: { action: "approve" as const, comments: "Checked" },
				publication: null,
			},
		})
		expect(PisoCampContentReviewDetailSchema.parse(approved)).toEqual(approved)

		expect(() =>
			PisoCampContentReviewDetailSchema.parse(detail({ publishAt: "2026-09-03T00:00:00.000Z" }))
		).toThrow()
	})
})
