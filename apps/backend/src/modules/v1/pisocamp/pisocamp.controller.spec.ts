import { SetMetadata } from "@nestjs/common"
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants"
import { Reflector } from "@nestjs/core"
import { Test, type TestingModule } from "@nestjs/testing"

import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { PisoCampController } from "./pisocamp.controller"
import { PisoCampService } from "./pisocamp.service"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((handler: (args: { input: unknown }) => unknown) =>
			handler({ input: { session_inactivity_minutes: 60 } })
		),
	})),
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: { pisocamp: { admin: { config: { get: {}, update: {} } }, config: { get: {} } } },
}))

jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

// This retains the real Nest metadata effect despite Jest not transforming
// the ESM auth package; the assertion below inspects that metadata directly.
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => SetMetadata("PUBLIC", true),
	Session: () => () => undefined,
}))

describe("PisoCampController", () => {
	let controller: PisoCampController
	const adminConfigService = {
		get: jest.fn(),
		update: jest.fn(),
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PisoCampController],
			providers: [
				PisoCampService,
				{ provide: PisoCampAdminConfigService, useValue: adminConfigService },
			],
		}).compile()

		controller = module.get(PisoCampController)
	})

	it("serves public defaults without a session", async () => {
		await expect(controller.getPublicConfig()).resolves.toEqual({
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
		})
	})

	it("marks the config handler as anonymous in Nest metadata", () => {
		const reflector = new Reflector()

		expect(reflector.get("PUBLIC", PisoCampController.prototype.getPublicConfig)).toBe(true)
	})

	it("requires admin.config.manage on both administrator handlers", () => {
		const reflector = new Reflector()

		expect(
			reflector.get(REQUIRED_PERMISSIONS_KEY, PisoCampController.prototype.getAdminConfig)
		).toEqual(["admin.config.manage"])
		expect(
			reflector.get(REQUIRED_PERMISSIONS_KEY, PisoCampController.prototype.updateAdminConfig)
		).toEqual(["admin.config.manage"])
	})

	it("marks PUT as strictly throttled and idempotent", () => {
		const handler = PisoCampController.prototype.updateAdminConfig

		expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, handler)).toBe(true)
		expect(Reflect.getMetadata(INTERCEPTORS_METADATA, handler)).toHaveLength(1)
	})

	it("derives the update actor from the authenticated session", async () => {
		adminConfigService.update.mockResolvedValue({ session_inactivity_minutes: 60 })

		await expect(
			controller.updateAdminConfig({ user: { id: "actor-1" } } as never)
		).resolves.toEqual({ session_inactivity_minutes: 60 })
		expect(adminConfigService.update).toHaveBeenCalledWith({
			actorId: "actor-1",
			session_inactivity_minutes: 60,
		})
	})
})
