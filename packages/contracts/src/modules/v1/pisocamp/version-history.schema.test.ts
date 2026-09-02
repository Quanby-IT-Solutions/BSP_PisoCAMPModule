import { describe, expect, it } from "vitest"

import { pisoCampContentContract } from "./content.contract.js"
import {
	ListPisoCampContentVersionsInputSchema,
	ListPisoCampContentVersionsOutputSchema,
	PisoCampContentDifferenceSchema,
	PisoCampContentVersionHistoryEntrySchema,
	RestorePisoCampContentVersionInputSchema,
	type PisoCampContentVersionHistoryEntry,
} from "./version-history.schema.js"

const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"
const versionId = "fd21cf65-807b-4546-a7ed-e803d28568d2"
const requestId = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"

const entry: PisoCampContentVersionHistoryEntry = {
	id: versionId,
	versionNo: 2,
	status: "published",
	contentType: "advisory",
	title: "Handle banknotes with care",
	createdBy: { id: "editor", name: "Elena Editor" },
	createdAt: "2026-09-01T00:00:00.000Z",
	approver: { id: "approver", name: "Sam Rivera" },
	approvedAt: "2026-09-01T01:00:00.000Z",
	publisher: { id: "approver", name: "Sam Rivera" },
	publishedAt: "2026-09-01T02:00:00.000Z",
	transitionAction: "publish",
	transitionComments: null,
	restoredFromVersionNo: null,
	isCurrentWorking: false,
	isCurrentPublished: true,
	restorable: true,
	differences: [{ field: "body", previous: "Old copy.", current: "New copy." }],
}

describe("CM-4 version history contract", () => {
	it("registers the history and restore routes under the content contract", () => {
		expect(pisoCampContentContract.versions["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/versions",
			tags: ["Piso CAMP Content Administration"],
		})
		expect(pisoCampContentContract.restore["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/admin/pisocamp/content/{itemId}/versions/{versionNo}/restore",
		})
	})

	it("coerces paging and rejects an unusable page size", () => {
		expect(ListPisoCampContentVersionsInputSchema.parse({ itemId })).toEqual({
			itemId,
			page: 1,
			limit: 20,
		})
		expect(
			ListPisoCampContentVersionsInputSchema.parse({ itemId, page: "3", limit: "50" })
		).toEqual({ itemId, page: 3, limit: 50 })
		expect(() => ListPisoCampContentVersionsInputSchema.parse({ itemId, limit: "51" })).toThrow()
		expect(() => ListPisoCampContentVersionsInputSchema.parse({ itemId, page: "0" })).toThrow()
	})

	it("requires a reason on restore and refuses restoring a version onto itself", () => {
		const input = { itemId, versionNo: 2, requestId, expectedVersionNo: 5, comments: "Reverting." }

		expect(RestorePisoCampContentVersionInputSchema.parse({ ...input, versionNo: "2" })).toEqual(
			input
		)
		expect(() =>
			RestorePisoCampContentVersionInputSchema.parse({ ...input, comments: "" })
		).toThrow()
		expect(() =>
			RestorePisoCampContentVersionInputSchema.parse({ ...input, versionNo: 5 })
		).toThrow()
		expect(() =>
			RestorePisoCampContentVersionInputSchema.parse({ ...input, extra: true })
		).toThrow()
	})

	it("refuses a difference whose two sides are equal", () => {
		expect(
			PisoCampContentDifferenceSchema.parse({ field: "title", previous: "a", current: "b" })
		).toEqual({ field: "title", previous: "a", current: "b" })
		expect(() =>
			PisoCampContentDifferenceSchema.parse({ field: "title", previous: "a", current: "a" })
		).toThrow()
		expect(() =>
			PisoCampContentDifferenceSchema.parse({ field: "unknown", previous: "a", current: "b" })
		).toThrow()
	})

	it("keeps approver and publisher metadata paired with their timestamps", () => {
		expect(PisoCampContentVersionHistoryEntrySchema.parse(entry)).toEqual(entry)
		expect(() =>
			PisoCampContentVersionHistoryEntrySchema.parse({ ...entry, approvedAt: null })
		).toThrow()
		expect(() =>
			PisoCampContentVersionHistoryEntrySchema.parse({ ...entry, publisher: null })
		).toThrow()
	})

	it("refuses to describe the current version as different from itself or restorable", () => {
		expect(() =>
			PisoCampContentVersionHistoryEntrySchema.parse({
				...entry,
				isCurrentWorking: true,
				restorable: false,
			})
		).toThrow()
		expect(() =>
			PisoCampContentVersionHistoryEntrySchema.parse({
				...entry,
				isCurrentWorking: true,
				restorable: true,
				differences: [],
			})
		).toThrow()
	})

	it("binds the paged history output to the exact procedure", () => {
		const output = {
			itemId,
			itemStatus: "published" as const,
			currentVersionNo: 2,
			restoreAvailable: true,
			versions: [entry],
			page: 1,
			limit: 20,
			total: 2,
		}

		expect(ListPisoCampContentVersionsOutputSchema.parse(output)).toEqual(output)
		expect(
			(
				pisoCampContentContract.versions["~orpc"]
					.outputSchema as typeof ListPisoCampContentVersionsOutputSchema
			).parse(output)
		).toEqual(output)
	})
})
