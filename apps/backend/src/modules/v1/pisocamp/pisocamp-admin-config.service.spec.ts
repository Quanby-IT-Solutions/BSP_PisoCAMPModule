import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"

jest.mock("@repo/db/schema", () => ({
	moduleConfiguration: { key: "key", value: "value" },
}))

jest.mock("drizzle-orm", () => ({
	eq: jest.fn(),
	inArray: jest.fn(),
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
}))

jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(), transaction: jest.fn() },
}))


/** Every key the contract requires, so a case can name only what it is about. */
function fullConfig(overrides: Record<string, unknown> = {}) {
	type AdminConfig = Parameters<PisoCampAdminConfigService["update"]>[0]
	return {
		session_inactivity_minutes: 30,
		exit_advisory_interval_hours: 24,
		churn_inactivity_days: 30,
		trivia_repeat_days: 30,
		leaderboard_enabled: false,
		leaderboard_top_group_percent: 10,
		key_action_events: ["content_view"],
		age_group_buckets: [{ minAge: 0, maxAge: null }],
		suppression_minimum: 10,
		recognition_confidence_threshold: 0.8,
		// Null keeps the notice lookup out of the cases that are not about it.
		active_privacy_notice_version: null,
		...overrides,
	} as unknown as AdminConfig
}

const mockDb = jest.requireMock("@/common/database/database.client").db as {
	select: jest.Mock
	transaction: jest.Mock
}
const selectWhere = jest.fn()
const selectFrom = jest.fn(() => ({ where: selectWhere }))

// The reads are keyed now: one query returns both settings.

describe("PisoCampAdminConfigService", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		mockDb.select.mockReturnValue({ from: selectFrom })
	})

	it("returns the stored value", async () => {
		selectWhere.mockResolvedValue([{ key: "session_inactivity_minutes", value: 45 }])
		const service = new PisoCampAdminConfigService({ record: jest.fn() } as never)

		await expect(service.get()).resolves.toMatchObject({
			session_inactivity_minutes: 45,
			exit_advisory_interval_hours: 24,
			churn_inactivity_days: 30,
		})
	})

	it("refuses to serve a stored value outside the contract's range", async () => {
		// A row somebody edited by hand is not a reason to report a setting the
		// contract would refuse; the declared default is.
		selectWhere.mockResolvedValue([
			{ key: "session_inactivity_minutes", value: 0 },
			{ key: "churn_inactivity_days", value: 400 },
		])
		const service = new PisoCampAdminConfigService({ record: jest.fn() } as never)

		await expect(service.get()).resolves.toMatchObject({
			session_inactivity_minutes: 30,
			exit_advisory_interval_hours: 24,
			churn_inactivity_days: 30,
		})
	})

	it("returns the default when the setting is missing", async () => {
		selectWhere.mockResolvedValue([])
		const service = new PisoCampAdminConfigService({ record: jest.fn() } as never)

		await expect(service.get()).resolves.toMatchObject({
			session_inactivity_minutes: 30,
			exit_advisory_interval_hours: 24,
			churn_inactivity_days: 30,
		})
	})

	it("commits the value and before/after audit together", async () => {
		const auditService = { record: jest.fn().mockResolvedValue(undefined) }
		const lockFor = jest.fn().mockResolvedValue([{ value: 30 }])
		const lockWhere = jest.fn(() => ({ for: lockFor }))
		const txSelect = jest.fn(() => ({ from: jest.fn(() => ({ where: lockWhere })) }))
		const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined)
		const values = jest.fn(() => ({ onConflictDoUpdate }))
		const tx = {
			select: txSelect,
			insert: jest.fn(() => ({ values })),
			delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
		}
		mockDb.transaction.mockImplementation(async work => work(tx))
		const service = new PisoCampAdminConfigService(auditService as never)

		await expect(
			service.update({
				...fullConfig({ session_inactivity_minutes: 60, churn_inactivity_days: 45 }),
				actorId: "actor-1",
			})
		).resolves.toMatchObject({
			session_inactivity_minutes: 60,
			exit_advisory_interval_hours: 24,
			churn_inactivity_days: 45,
		})
		// One entry per setting that actually moved, so a later question about
		// any one of them has an answer that names it.
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
		// An unchanged setting is not an event: the interval stayed at 24, so
		// nothing about it belongs in the trail.
		const audited = auditService.record.mock.calls.map(
			([entry]: [{ targetId: string }]) => entry.targetId
		)
		expect(audited).toContain("session_inactivity_minutes")
		expect(audited).not.toContain("exit_advisory_interval_hours")
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
			delete: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
		}
		let committed = false
		mockDb.transaction.mockImplementation(async work => {
			const result = await work(tx)
			committed = true
			return result
		})
		const service = new PisoCampAdminConfigService(auditService as never)

		await expect(
			service.update({
				...fullConfig({ session_inactivity_minutes: 60 }),
				actorId: "actor-1",
			})
		).rejects.toBe(auditFailure)
		expect(committed).toBe(false)
	})
})
