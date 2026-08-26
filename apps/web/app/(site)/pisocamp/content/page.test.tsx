import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampContentPage, { metadata } from "./page"

const { redirect, getAccess, contentListView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	getAccess: vi.fn(),
	contentListView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-list-view", () => ({
	ContentListView: () => {
		contentListView()
		return <div>Content feature view</div>
	},
}))

describe("PisoCampContentPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has a content administration title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Content" }))
	})

	it("renders the feature view with exactly content.items.edit", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.edit"],
		})

		render(await PisoCampContentPage())

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText("Content feature view")).toBeInTheDocument()
	})

	it.each([
		["missing permission", { status: "loaded", roles: ["Admin"], permissions: [] }],
		[
			"access lookup error",
			{ status: "error", roles: [], permissions: [], error: "request-failed" },
		],
	])("redirects on %s", async (_label, access) => {
		getAccess.mockResolvedValue(access)

		await expect(PisoCampContentPage()).rejects.toThrow("NEXT_REDIRECT")

		expect(redirect).toHaveBeenCalledWith("/dashboard")
		expect(contentListView).not.toHaveBeenCalled()
	})
})
