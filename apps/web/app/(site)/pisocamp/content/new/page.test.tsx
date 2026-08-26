import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import NewPisoCampContentPage, { metadata } from "./page"

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
	ContentFormView: ({ mode }: { mode: string }) => {
		contentFormView({ mode })
		return <div>Content form: {mode}</div>
	},
}))

describe("NewPisoCampContentPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the nested new-content title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "New Content" }))
	})

	it("renders the create feature view with exactly content.items.edit", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.edit"],
		})

		render(await NewPisoCampContentPage())

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText("Content form: create")).toBeInTheDocument()
	})

	it.each([
		["missing permission", { status: "loaded", roles: ["Admin"], permissions: [] }],
		[
			"access lookup error",
			{ status: "error", roles: [], permissions: [], error: "invalid-response" },
		],
	])("redirects on %s", async (_label, access) => {
		getAccess.mockResolvedValue(access)

		await expect(NewPisoCampContentPage()).rejects.toThrow("NEXT_REDIRECT")

		expect(redirect).toHaveBeenCalledWith("/dashboard")
		expect(contentFormView).not.toHaveBeenCalled()
	})
})
