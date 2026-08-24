import { beforeEach, describe, expect, it, vi } from "vitest"

import PisoCampConfigPage from "./page"

const { redirect, getAccess } = vi.hoisted(() => ({
	redirect: vi.fn(),
	getAccess: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect }))
vi.mock("@/features/dashboard/server/get-access", () => ({ getAccess }))

describe("PisoCampConfigPage", () => {
	beforeEach(() => vi.clearAllMocks())

	it("allows direct access with admin.config.manage", async () => {
		getAccess.mockResolvedValue({
			status: "loaded",
			roles: [],
			permissions: ["admin.config.manage"],
		})

		await PisoCampConfigPage()

		expect(redirect).not.toHaveBeenCalled()
	})

	it("redirects direct access without admin.config.manage", async () => {
		getAccess.mockResolvedValue({ status: "loaded", roles: ["Admin"], permissions: [] })

		await PisoCampConfigPage()

		expect(redirect).toHaveBeenCalledWith("/dashboard")
	})
})
