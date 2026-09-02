import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampContentAuditPage, { metadata } from "./page"

const { redirect, getAccess, auditView } = vi.hoisted(() => ({
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT")
	}),
	getAccess: vi.fn(),
	auditView: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))
vi.mock("@/features/pisocamp-content-admin/components/content-audit-view", () => ({
	ContentAuditView: ({ itemId }: { itemId: string }) => {
		auditView({ itemId })
		return <div>Audit: {itemId}</div>
	},
}))

const itemId = "38fd44f4-ebde-49b1-86e0-b6711ccf6756"
const route = { params: Promise.resolve({ itemId }) }

describe("PisoCampContentAuditPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("has the nested audit-history title", () => {
		expect(metadata).toEqual(expect.objectContaining({ title: "Audit History" }))
	})

	it("renders the trail for a holder of content.audit.view", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["content.audit.view"],
		})

		render(await PisoCampContentAuditPage(route))

		expect(redirect).not.toHaveBeenCalled()
		expect(screen.getByText(`Audit: ${itemId}`)).toBeInTheDocument()
		expect(auditView).toHaveBeenCalledWith({ itemId })
	})

	it.each([["content.items.approve"], ["content.items.publish"], ["content.items.restore"]])(
		"does not let %s substitute for the audit permission",
		async permission => {
			getAccess.mockResolvedValue({ status: "loaded", roles: [], permissions: [permission] })

			await expect(PisoCampContentAuditPage(route)).rejects.toThrow("NEXT_REDIRECT")

			expect(redirect).toHaveBeenCalledWith("/dashboard")
			expect(auditView).not.toHaveBeenCalled()
		}
	)

	it("redirects when the access lookup fails", async () => {
		getAccess.mockResolvedValue({
			status: "error",
			roles: [],
			permissions: ["content.audit.view"],
			error: "request-failed",
		})

		await expect(PisoCampContentAuditPage(route)).rejects.toThrow("NEXT_REDIRECT")

		expect(auditView).not.toHaveBeenCalled()
	})
})
