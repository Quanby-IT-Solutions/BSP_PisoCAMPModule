import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampContentReviewPage, { metadata } from "./page"

const { redirect, getAccess, reviewQueueView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	getAccess: vi.fn(),
	reviewQueueView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-review-queue-view", () => ({
	ContentReviewQueueView: ({ canReview }: { canReview: boolean }) => {
		reviewQueueView({ canReview })
		return <div>Content review queue</div>
	},
}))

describe("PisoCampContentReviewPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the exact content-review title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Content Review" }))
	})

	it("renders the queue with an explicit review capability", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.approve"],
		})

		render(await PisoCampContentReviewPage())

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText("Content review queue")).toBeInTheDocument()
		expect(reviewQueueView).toHaveBeenCalledWith({ canReview: true })
	})

	it.each([
		["missing permission", { status: "loaded", roles: ["Admin"], permissions: [] }],
		["access lookup error", { status: "error", roles: [], permissions: [] }],
	])("redirects to the dashboard on %s", async (_label, access) => {
		getAccess.mockResolvedValue(access)

		await expect(PisoCampContentReviewPage()).rejects.toThrow("NEXT_REDIRECT")

		expect(redirect).toHaveBeenCalledWith("/dashboard")
		expect(reviewQueueView).not.toHaveBeenCalled()
	})
})
