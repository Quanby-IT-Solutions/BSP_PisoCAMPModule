import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampContentPreviewPage, { metadata } from "./page"

const { redirect, notFound, getAccess, previewView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND")
	}),
	getAccess: vi.fn(),
	previewView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect, notFound }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-preview-view", () => ({
	ContentPreviewView: ({ itemId, versionNo }: { itemId: string; versionNo: number }) => {
		previewView({ itemId, versionNo })
		return (
			<div>
				Preview: {itemId} v{versionNo}
			</div>
		)
	},
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const route = (versionNo: string) => ({ params: Promise.resolve({ itemId, versionNo }) })

describe("PisoCampContentPreviewPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the nested preview-content title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Preview Content" }))
	})

	it("renders the preview for a holder of content.items.preview", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.preview"],
		})

		render(await PisoCampContentPreviewPage(route("4")))

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText(`Preview: ${itemId} v4`)).toBeInTheDocument()
		expect(previewView).toHaveBeenCalledWith({ itemId, versionNo: 4 })
	})

	it.each([
		["content.items.edit"],
		["content.items.approve"],
		["content.items.publish"],
	])("does not let %s substitute for the preview permission", async permission => {
		getAccess.mockResolvedValue({ status: "loaded", roles: [], permissions: [permission] })

		await expect(PisoCampContentPreviewPage(route("4"))).rejects.toThrow("NEXT_REDIRECT")

		expect(redirect).toHaveBeenCalledWith("/dashboard")
		expect(previewView).not.toHaveBeenCalled()
	})

	it("redirects when the access lookup fails", async () => {
		getAccess.mockResolvedValue({
			status: "error",
			roles: [],
			permissions: ["content.items.preview"],
			error: "request-failed",
		})

		await expect(PisoCampContentPreviewPage(route("4"))).rejects.toThrow("NEXT_REDIRECT")

		expect(previewView).not.toHaveBeenCalled()
	})

	it.each([["0"], ["-1"], ["1.5"], ["abc"], [""]])(
		"refuses the unusable version segment %p before rendering",
		async versionNo => {
			getAccess.mockResolvedValue({
				status: "loaded",
				roles: [],
				permissions: ["content.items.preview"],
			})

			await expect(PisoCampContentPreviewPage(route(versionNo))).rejects.toThrow("NEXT_NOT_FOUND")

			expect(previewView).not.toHaveBeenCalled()
		}
	)
})
