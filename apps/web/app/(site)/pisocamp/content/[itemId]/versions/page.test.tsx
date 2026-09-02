import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampContentVersionsPage, { metadata } from "./page"

const { redirect, getAccess, historyView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	getAccess: vi.fn(),
	historyView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-version-history-view", () => ({
	ContentVersionHistoryView: ({
		canRestore,
		itemId,
	}: {
		canRestore: boolean
		itemId: string
	}) => {
		historyView({ canRestore, itemId })
		return <div>History: {itemId}</div>
	},
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const route = { params: Promise.resolve({ itemId }) }

describe("PisoCampContentVersionsPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the nested version-history title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Version History" }))
	})

	it("renders history for a holder of content.items.restore", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.items.restore"],
		})

		render(await PisoCampContentVersionsPage(route))

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText(`History: ${itemId}`)).toBeInTheDocument()
		expect(historyView).toHaveBeenCalledWith({ canRestore: true, itemId })
	})

	it.each([["content.items.approve"], ["content.items.publish"], ["content.items.edit"]])(
		"does not let %s substitute for the restore permission",
		async permission => {
			getAccess.mockResolvedValue({ status: "loaded", roles: [], permissions: [permission] })

			await expect(PisoCampContentVersionsPage(route)).rejects.toThrow("NEXT_REDIRECT")

			expect(redirect).toHaveBeenCalledWith("/dashboard")
			expect(historyView).not.toHaveBeenCalled()
		}
	)

	it("redirects when the access lookup fails", async () => {
		getAccess.mockResolvedValue({
			status: "error",
			roles: [],
			permissions: ["content.items.restore"],
			error: "request-failed",
		})

		await expect(PisoCampContentVersionsPage(route)).rejects.toThrow("NEXT_REDIRECT")

		expect(historyView).not.toHaveBeenCalled()
	})
})
