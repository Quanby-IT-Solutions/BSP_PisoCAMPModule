import { SetMetadata } from "@nestjs/common"
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants"
import { Test } from "@nestjs/testing"

import { IDEMPOTENCY_REQUIREMENT_KEY } from "@/shared/decorators/require-idempotency.decorator"

import { PisoCampProfileController } from "./pisocamp-profile.controller"
import { PisoCampProfileService } from "./pisocamp-profile.service"

jest.mock("@orpc/nest", () => ({ Implement: () => () => undefined }))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message)
		}
	},
	implement: jest.fn((contract: string) => ({
		handler: (handler: (args: { input: unknown }) => unknown) =>
			handler({
				input:
					contract === "profileUpsert"
						? {
								id: "8bdc754e-3d04-4eab-b98c-523f378ac1e4",
								gender: "female",
								age: 30,
								regionCode: "1300000000",
								cityCode: "1380600000",
							}
						: {},
			}),
	})),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			locations: { get: "locationsGet" },
			profile: { get: "profileGet", upsert: "profileUpsert" },
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => SetMetadata("PUBLIC", true),
	Session: () => () => undefined,
}))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

describe("PisoCampProfileController", () => {
	const service = { getLocations: jest.fn(), getProfile: jest.fn(), completeProfile: jest.fn() }
	let controller: PisoCampProfileController
	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [PisoCampProfileController],
			providers: [{ provide: PisoCampProfileService, useValue: service }],
		}).compile()
		controller = module.get(PisoCampProfileController)
		jest.clearAllMocks()
	})

	it("keeps only the location catalog public and profile POST idempotent", () => {
		expect(Reflect.getMetadata("PUBLIC", PisoCampProfileController.prototype.getLocations)).toBe(
			true
		)
		expect(
			Reflect.getMetadata("PUBLIC", PisoCampProfileController.prototype.getProfile)
		).toBeUndefined()
		expect(
			Reflect.getMetadata(
				INTERCEPTORS_METADATA,
				PisoCampProfileController.prototype.completeProfile
			)
		).toHaveLength(1)
		expect(
			Reflect.getMetadata(
				IDEMPOTENCY_REQUIREMENT_KEY,
				PisoCampProfileController.prototype.completeProfile
			)
		).toEqual({ requestIdField: "id", requireActiveAccount: true })
	})

	it("uses the verified session account and exact device header, never client identity", async () => {
		service.completeProfile.mockResolvedValue({ status: "complete" })
		await controller.completeProfile(
			{ user: { id: "account-1" } } as never,
			{ headers: { "x-device-pseudo-id": "AbCdEfGhIjKlMnOpQrSt_-" } } as never
		)
		expect(service.completeProfile).toHaveBeenCalledWith(
			"account-1",
			"AbCdEfGhIjKlMnOpQrSt_-",
			expect.objectContaining({ age: 30 })
		)
	})

	it("rejects a missing or malformed device identity as typed bad request", async () => {
		await expect(
			controller.completeProfile({ user: { id: "account-1" } } as never, { headers: {} } as never)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
	})
})
