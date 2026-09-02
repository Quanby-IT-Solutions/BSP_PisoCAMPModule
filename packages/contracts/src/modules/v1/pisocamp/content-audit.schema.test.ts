import { describe, expect, it } from "vitest"

import {
	ListPisoCampContentAuditInputSchema,
	ListPisoCampContentAuditOutputSchema,
	PisoCampContentAuditEntrySchema,
} from "./content-audit.schema.js"
import { pisoCampContentContract } from "./content.contract.js"

const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"

const entry = {
	id: 12,
	action: "content.publish" as const,
	fromState: "approved" as const,
	toState: "published" as const,
	versionNo: 4,
	comments: null,
	actor: { id: "approver", name: "Sam Rivera" },
	at: "2026-09-01T04:00:00.000Z",
}

describe("CM-7 content audit contract", () => {
	it("registers the per-item audit route", () => {
		expect(pisoCampContentContract.audit["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/admin/pisocamp/content/{itemId}/audit",
			tags: ["Piso CAMP Content Administration"],
		})
	})

	it("defaults paging and coerces it from the query string", () => {
		expect(ListPisoCampContentAuditInputSchema.parse({ itemId })).toEqual({
			itemId,
			page: 1,
			limit: 25,
		})
		expect(ListPisoCampContentAuditInputSchema.parse({ itemId, page: "2", limit: "100" })).toEqual({
			itemId,
			page: 2,
			limit: 100,
		})
		expect(() => ListPisoCampContentAuditInputSchema.parse({ itemId, limit: "101" })).toThrow()
	})

	it("accepts each filter and refuses an inverted date range", () => {
		const base = { itemId, page: 1, limit: 25 }

		expect(
			ListPisoCampContentAuditInputSchema.parse({
				...base,
				actorId: "approver",
				action: "content.approve",
				from: "2026-09-01T00:00:00.000Z",
				to: "2026-09-02T00:00:00.000Z",
			})
		).toMatchObject({ actorId: "approver", action: "content.approve" })

		expect(() =>
			ListPisoCampContentAuditInputSchema.parse({
				...base,
				from: "2026-09-03T00:00:00.000Z",
				to: "2026-09-02T00:00:00.000Z",
			})
		).toThrow()
		expect(() =>
			ListPisoCampContentAuditInputSchema.parse({ ...base, action: "content.invented" })
		).toThrow()
		expect(() =>
			ListPisoCampContentAuditInputSchema.parse({ ...base, from: "2026-09-01T08:00:00+08:00" })
		).toThrow()
	})

	it("describes an entry with a nullable actor and nullable transition states", () => {
		expect(PisoCampContentAuditEntrySchema.parse(entry)).toEqual(entry)
		expect(
			PisoCampContentAuditEntrySchema.parse({
				...entry,
				action: "content.edit",
				fromState: null,
				toState: null,
				actor: null,
			})
		).toMatchObject({ actor: null, fromState: null })
		expect(() => PisoCampContentAuditEntrySchema.parse({ ...entry, at: "not-a-time" })).toThrow()
		expect(() => PisoCampContentAuditEntrySchema.parse({ ...entry, extra: true })).toThrow()
	})

	it("binds the paged output to the exact procedure", () => {
		const output = {
			itemId,
			entries: [entry],
			actors: [{ id: "approver", name: "Sam Rivera" }],
			page: 1,
			limit: 25,
			total: 1,
		}

		expect(ListPisoCampContentAuditOutputSchema.parse(output)).toEqual(output)
		expect(
			(
				pisoCampContentContract.audit["~orpc"]
					.outputSchema as typeof ListPisoCampContentAuditOutputSchema
			).parse(output)
		).toEqual(output)
	})
})
