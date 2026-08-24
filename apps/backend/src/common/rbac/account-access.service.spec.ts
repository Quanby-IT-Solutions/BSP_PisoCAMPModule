import { AccountAccessService } from "./account-access.service"

jest.mock("@repo/db/schema", () => ({
	pisoCampAccountState: { accountId: "accountId", status: "status" },
}))

const where = jest.fn()
const from = jest.fn(() => ({ where }))
jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(() => ({ from })) },
}))

describe("AccountAccessService", () => {
	beforeEach(() => jest.clearAllMocks())

	it("treats a missing account-state row as active", async () => {
		where.mockResolvedValue([])

		await expect(new AccountAccessService().isActive("user-1")).resolves.toBe(true)
	})

	it("rejects a deactivated account", async () => {
		where.mockResolvedValue([{ status: "deactivated" }])

		await expect(new AccountAccessService().isActive("user-1")).resolves.toBe(false)
	})
})
