import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import EditPisoCampContentPage, { metadata } from "./page"

const { redirect, getAccess, contentFormView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	getAccess: vi.fn(),
	contentFormView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-form-view", () => ({
	ContentFormView: ({
		canSubmit,
		itemId,
		mode,
	}: {
		canSubmit: boolean
		itemId: string
		mode: string
	}) => {
		contentFormView({ canSubmit, itemId, mode })
		return (
			<div>
				Content form: {mode} {itemId}
			</div>
		)
	},
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const route = { params: Promise.resolve({ itemId }) }

describe("EditPisoCampContentPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the nested edit-content title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Edit Content" }))
	})

	it("passes an explicit submit capability to the item edit feature view", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.edit", "content.items.submit"],
		})

		render(await EditPisoCampContentPage(route))

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText(`Content form: edit ${itemId}`)).toBeInTheDocument()
		expect(contentFormView).toHaveBeenCalledWith({ canSubmit: true, itemId, mode: "edit" })
	})

	it("keeps editing available while withholding submit capability without its exact permission", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.edit"],
		})

		render(await EditPisoCampContentPage(route))

		expect(contentFormView).toHaveBeenCalledWith({ canSubmit: false, itemId, mode: "edit" })
	})

	it.each([
		["missing permission", { status: "loaded", roles: ["Admin"], permissions: [] }],
		[
			"access lookup error",
			{ status: "error", roles: [], permissions: [], error: "request-failed" },
		],
	])("redirects on %s", async (_label, access) => {
		getAccess.mockResolvedValue(access)

		await expect(EditPisoCampContentPage(route)).rejects.toThrow("NEXT_REDIRECT")

		expect(redirect).toHaveBeenCalledWith("/dashboard")
		expect(contentFormView).not.toHaveBeenCalled()
	})
})
