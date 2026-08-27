import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampContentReviewDetailPage, { metadata } from "./page"

const { redirect, getAccess, reviewView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	getAccess: vi.fn(),
	reviewView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-review-view", () => ({
	ContentReviewView: ({
		canApprove,
		canPublish,
		itemId,
	}: {
		canApprove: boolean
		canPublish: boolean
		itemId: string
	}) => {
		reviewView({ canApprove, canPublish, itemId })
		return <div>Review content {itemId}</div>
	},
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const route = { params: Promise.resolve({ itemId }) }

describe("PisoCampContentReviewDetailPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the exact review-content title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Review Content" }))
	})

	it.each([
		["without publish permission", ["content.items.approve"], false],
		["with publish permission", ["content.items.approve", "content.items.publish"], true],
	] as const)("passes explicit capabilities %s", async (_label, permissions, canPublish) => {
		getAccess.mockResolvedValue({ status: "loaded", roles: [], permissions })

		render(await PisoCampContentReviewDetailPage(route))

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText(`Review content ${itemId}`)).toBeInTheDocument()
		expect(reviewView).toHaveBeenCalledWith({ canApprove: true, canPublish, itemId })
	})

	it.each([
		["missing permission", { status: "loaded", roles: ["Admin"], permissions: [] }],
		["access lookup error", { status: "error", roles: [], permissions: [] }],
	])("redirects to the dashboard on %s", async (_label, access) => {
		getAccess.mockResolvedValue(access)

		await expect(PisoCampContentReviewDetailPage(route)).rejects.toThrow("NEXT_REDIRECT")

		expect(redirect).toHaveBeenCalledWith("/dashboard")
		expect(reviewView).not.toHaveBeenCalled()
	})
})
