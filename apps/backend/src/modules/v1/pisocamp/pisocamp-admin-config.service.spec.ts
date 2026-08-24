import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"

jest.mock("@repo/db/schema", () => ({
	moduleConfiguration: { key: "key", value: "value" },
}))

jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(), transaction: jest.fn() },
}))

const mockDb = jest.requireMock("@/common/database/database.client").db as {
	select: jest.Mock
	transaction: jest.Mock
}
const selectWhere = jest.fn()
const selectFrom = jest.fn(() => ({ where: selectWhere }))

describe("PisoCampAdminConfigService", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		mockDb.select.mockReturnValue({ from: selectFrom })
	})

	it("returns the stored value", async () => {
		selectWhere.mockResolvedValue([{ value: 45 }])
		const service = new PisoCampAdminConfigService({ record: jest.fn() } as never)

		await expect(service.get()).resolves.toEqual({ session_inactivity_minutes: 45 })
	})

	it("returns the default when the setting is missing", async () => {
		selectWhere.mockResolvedValue([])
		const service = new PisoCampAdminConfigService({ record: jest.fn() } as never)

		await expect(service.get()).resolves.toEqual({ session_inactivity_minutes: 30 })
	})

	it("commits the value and before/after audit together", async () => {
		const auditService = { record: jest.fn().mockResolvedValue(undefined) }
		const lockFor = jest.fn().mockResolvedValue([{ value: 30 }])
		const lockWhere = jest.fn(() => ({ for: lockFor }))
		const txSelect = jest.fn(() => ({ from: jest.fn(() => ({ where: lockWhere })) }))
		const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined)
		const values = jest.fn(() => ({ onConflictDoUpdate }))
		const tx = { select: txSelect, insert: jest.fn(() => ({ values })) }
		mockDb.transaction.mockImplementation(async work => work(tx))
		const service = new PisoCampAdminConfigService(auditService as never)

		await expect(
			service.update({ actorId: "actor-1", session_inactivity_minutes: 60 })
		).resolves.toEqual({ session_inactivity_minutes: 60 })
		expect(auditService.record).toHaveBeenCalledWith(
			{
				domain: "pisocamp",
				action: "module_configuration.update",
				actorId: "actor-1",
				targetType: "module_configuration",
				targetId: "session_inactivity_minutes",
				oldValue: 30,
				newValue: 60,
			},
			tx
		)
	})

	it("rejects the transaction when audit persistence fails", async () => {
		const auditFailure = new Error("audit failed")
		const auditService = { record: jest.fn().mockRejectedValue(auditFailure) }
		const tx = {
			select: jest.fn(() => ({
				from: jest.fn(() => ({
					where: jest.fn(() => ({ for: jest.fn().mockResolvedValue([{ value: 30 }]) })),
				})),
			})),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({ onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) })),
			})),
		}
		let committed = false
		mockDb.transaction.mockImplementation(async work => {
			const result = await work(tx)
			committed = true
			return result
		})
		const service = new PisoCampAdminConfigService(auditService as never)

		await expect(
			service.update({ actorId: "actor-1", session_inactivity_minutes: 60 })
		).rejects.toBe(auditFailure)
		expect(committed).toBe(false)
	})
})
