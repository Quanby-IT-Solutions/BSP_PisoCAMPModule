import { describe, expect, it } from "vitest"
import type { z } from "zod"

import { v1Contract } from "../v1.contract.js"
import { pisoCampContentContract } from "./content.contract.js"

const requestId = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"
const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"
const timestamp = "2026-08-25T02:03:04.000Z"
const content = {
	contentType: "banknote",
	title: "20-Piso New Generation Currency Banknote",
	summary: "Approved educational summary",
	body: "Approved plain-text description.",
	seriesCode: "ngc-banknotes",
	denominationCode: "php-20",
} as const
const editor = { id: "content-editor-1", name: "Content Editor" } as const
const detail = {
	id: itemId,
	contentType: "banknote",
	status: "draft",
	currentVersion: {
		id: "fd21cf65-807b-4546-a7ed-e803d28568d2",
		versionNo: 1,
		status: "draft",
		content,
		relatedLinks: [],
	},
	creator: editor,
	lastEditor: editor,
	createdAt: timestamp,
	dateModified: timestamp,
} as const

function parse(schema: unknown, value: unknown): unknown {
	return (schema as z.ZodType).parse(value)
}

describe("CM-1 content contract", () => {
	it.each([
		["list", "GET", "/admin/pisocamp/content"],
		["get", "GET", "/admin/pisocamp/content/{itemId}"],
		["create", "POST", "/admin/pisocamp/content"],
		["update", "PUT", "/admin/pisocamp/content/{itemId}"],
	] as const)("registers %s at the exact unversioned route", (procedure, method, path) => {
		expect(pisoCampContentContract[procedure]["~orpc"].route).toMatchObject({ method, path })
	})

	it.each([
		["list", "GET", "/v1/admin/pisocamp/content"],
		["get", "GET", "/v1/admin/pisocamp/content/{itemId}"],
		["create", "POST", "/v1/admin/pisocamp/content"],
		["update", "PUT", "/v1/admin/pisocamp/content/{itemId}"],
	] as const)("composes %s once under the v1 router", (procedure, method, path) => {
		expect(v1Contract.pisocamp.admin.content[procedure]["~orpc"].route).toMatchObject({
			method,
			path,
		})
	})

	it("binds representative list input and output schemas", () => {
		const list = pisoCampContentContract.list["~orpc"]
		const input = { page: "2", limit: "20", status: "draft" }
		const output = {
			items: [
				{
					id: itemId,
					contentType: "banknote",
					status: "draft",
					title: content.title,
					seriesCode: "ngc-banknotes",
					denominationCode: "php-20",
					currentVersionNo: 1,
					creator: editor,
					lastEditor: editor,
					createdAt: timestamp,
					dateModified: timestamp,
				},
			],
			page: 2,
			limit: 20,
			total: 21,
		}

		expect(parse(list.inputSchema, input)).toEqual({ page: 2, limit: 20, status: "draft" })
		expect(parse(list.outputSchema, output)).toEqual(output)
	})

	it("binds representative detail, create, and update schemas", () => {
		const createInput = { requestId, content, relatedLinks: [] }
		const updateInput = {
			itemId,
			requestId,
			expectedVersionNo: 1,
			content,
			relatedLinks: [],
		}

		expect(parse(pisoCampContentContract.get["~orpc"].inputSchema, { itemId })).toEqual({
			itemId,
		})
		expect(parse(pisoCampContentContract.get["~orpc"].outputSchema, detail)).toEqual(detail)
		expect(parse(pisoCampContentContract.create["~orpc"].inputSchema, createInput)).toEqual(
			createInput
		)
		expect(parse(pisoCampContentContract.create["~orpc"].outputSchema, detail)).toEqual(detail)
		expect(parse(pisoCampContentContract.update["~orpc"].inputSchema, updateInput)).toEqual(
			updateInput
		)
		expect(parse(pisoCampContentContract.update["~orpc"].outputSchema, detail)).toEqual(detail)
	})
})

describe("CM-3 content workflow contract", () => {
	const workflow = pisoCampContentContract as typeof pisoCampContentContract &
		Record<string, { "~orpc"?: { route?: unknown; inputSchema?: unknown; outputSchema?: unknown } }>

	it.each([
		["reviewQueue", "GET", "/admin/pisocamp/content/review-queue"],
		["review", "GET", "/admin/pisocamp/content/{itemId}/review"],
		["submit", "POST", "/admin/pisocamp/content/{itemId}/submit"],
		["approve", "POST", "/admin/pisocamp/content/{itemId}/approve"],
		["reject", "POST", "/admin/pisocamp/content/{itemId}/reject"],
		["publish", "POST", "/admin/pisocamp/content/{itemId}/publish"],
	] as const)("registers %s at the exact unversioned route", (procedure, method, path) => {
		expect(workflow[procedure]?.["~orpc"]?.route).toMatchObject({ method, path })
	})

	it.each([
		["reviewQueue", "GET", "/v1/admin/pisocamp/content/review-queue"],
		["review", "GET", "/v1/admin/pisocamp/content/{itemId}/review"],
		["submit", "POST", "/v1/admin/pisocamp/content/{itemId}/submit"],
		["approve", "POST", "/v1/admin/pisocamp/content/{itemId}/approve"],
		["reject", "POST", "/v1/admin/pisocamp/content/{itemId}/reject"],
		["publish", "POST", "/v1/admin/pisocamp/content/{itemId}/publish"],
	] as const)("composes %s once under the v1 router", (procedure, method, path) => {
		const composed = v1Contract.pisocamp.admin.content as typeof workflow
		expect(composed[procedure]?.["~orpc"]?.route).toMatchObject({ method, path })
	})

	it("binds strict review queue, review detail, and transition schemas", () => {
		const reviewDetail = {
			...detail,
			status: "approved",
			publishAt: null,
			currentVersion: {
				...detail.currentVersion,
				versionNo: 2,
				status: "approved",
				createdBy: editor,
				createdAt: timestamp,
				transition: { action: "approve", comments: "Reviewed against BSP copy." },
				approval: { actor: editor, at: timestamp },
				publication: null,
			},
		} as const
		const queueInput = { page: "2", limit: "20", status: "approved" }
		const queueOutput = {
			items: [
				{
					id: itemId,
					contentType: "banknote",
					status: "approved",
					title: content.title,
					seriesCode: "ngc-banknotes",
					denominationCode: "php-20",
					currentVersionNo: 2,
					creator: editor,
					lastEditor: editor,
					createdAt: timestamp,
					dateModified: timestamp,
				},
			],
			page: 2,
			limit: 20,
			total: 1,
		} as const

		expect(parse(workflow.reviewQueue?.["~orpc"]?.inputSchema, queueInput)).toEqual({
			page: 2,
			limit: 20,
			status: "approved",
		})
		expect(parse(workflow.reviewQueue?.["~orpc"]?.outputSchema, queueOutput)).toEqual(queueOutput)
		expect(parse(workflow.review?.["~orpc"]?.inputSchema, { itemId })).toEqual({ itemId })
		expect(parse(workflow.review?.["~orpc"]?.outputSchema, reviewDetail)).toEqual(reviewDetail)

		for (const [procedure, input] of [
			["submit", { itemId, requestId, expectedVersionNo: 1 }],
			[
				"approve",
				{ itemId, requestId, expectedVersionNo: 1, comments: "Reviewed against BSP copy." },
			],
			["reject", { itemId, requestId, expectedVersionNo: 1, comments: "Please revise the copy." }],
			["publish", { itemId, requestId, expectedVersionNo: 1 }],
		] as const) {
			expect(parse(workflow[procedure]?.["~orpc"]?.inputSchema, input)).toEqual(input)
			expect(parse(workflow[procedure]?.["~orpc"]?.outputSchema, reviewDetail)).toEqual(
				reviewDetail
			)
		}
	})
})
