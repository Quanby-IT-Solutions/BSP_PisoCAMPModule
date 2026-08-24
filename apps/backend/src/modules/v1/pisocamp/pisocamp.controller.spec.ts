import { SetMetadata } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { Test, type TestingModule } from "@nestjs/testing"

import { PisoCampController } from "./pisocamp.controller"
import { PisoCampService } from "./pisocamp.service"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((handler: () => unknown) => handler()),
	})),
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: { pisocamp: { config: { get: {} } } },
}))

// This retains the real Nest metadata effect despite Jest not transforming
// the ESM auth package; the assertion below inspects that metadata directly.
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => SetMetadata("PUBLIC", true),
}))

describe("PisoCampController", () => {
	let controller: PisoCampController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PisoCampController],
			providers: [PisoCampService],
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
})
