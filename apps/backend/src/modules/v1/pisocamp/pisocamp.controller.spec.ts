import {
	BadRequestException,
	ConflictException,
	SetMetadata,
	UnauthorizedException,
} from "@nestjs/common"
import { INTERCEPTORS_METADATA } from "@nestjs/common/constants"
import { Reflector } from "@nestjs/core"
import { Test, type TestingModule } from "@nestjs/testing"

import { IDEMPOTENCY_REQUIREMENT_KEY } from "@/shared/decorators/require-idempotency.decorator"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"

import { PisoCampAdminConfigService } from "./pisocamp-admin-config.service"
import { PisoCampConsentSubjectService } from "./pisocamp-consent-subject.service"
import { PisoCampConsentService } from "./pisocamp-consent.service"
import { PisoCampController } from "./pisocamp.controller"
import { SurveyTriggerService } from "./surveys/survey-trigger.service"
import { PisoCampService } from "./pisocamp.service"

jest.mock("./pisocamp-consent-subject.service", () => ({
	PisoCampConsentSubjectService: class PisoCampConsentSubjectService {},
}))
jest.mock("./pisocamp-consent.service", () => ({
	PisoCampConsentService: class PisoCampConsentService {},
}))

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		readonly code: string
		constructor(code: string, options?: { message?: string }) {
			super(options?.message)
			this.code = code
		}
	},
	implement: jest.fn((contract: string) => ({
		handler: jest.fn((handler: (args: { input: unknown }) => unknown) =>
			handler({
				input:
					contract === "consentGet"
						? { purpose: "registration" }
						: contract === "consentRecord"
							? {
									id: "b3e8f099-a472-42c2-8e82-890446fe6411",
									purpose: "registration",
									noticeId: "1cca6b9c-b217-5e59-b679-c9368763274d",
									noticeVersion: "2024-12-26",
									decision: "granted",
									respondedAt: "2026-08-24T01:02:03.000Z",
								}
							: { session_inactivity_minutes: 60 },
			})
		),
	})),
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			admin: { config: { get: "adminGet", update: "adminUpdate" } },
			config: { get: "publicConfig" },
			consent: { get: "consentGet", record: "consentRecord" },
		},
	},
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
	const consentService = { getStatus: jest.fn(), record: jest.fn() }
	const subjectService = { resolve: jest.fn() }
	// EV-3: the public configuration carries the trigger rules, so the service
	// has a collaborator now. The rules themselves are proven elsewhere.
	const triggerService = { publicRules: jest.fn().mockResolvedValue([]) }

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [PisoCampController],
			providers: [
				PisoCampService,
				{ provide: SurveyTriggerService, useValue: triggerService },
				{ provide: PisoCampAdminConfigService, useValue: adminConfigService },
				{ provide: PisoCampConsentService, useValue: consentService },
				{ provide: PisoCampConsentSubjectService, useValue: subjectService },
			],
		}).compile()

		controller = module.get(PisoCampController)
	})

	it("marks both consent procedures anonymous while keeping POST strict and idempotent", () => {
		const reflector = new Reflector()
		expect(reflector.get("PUBLIC", PisoCampController.prototype.getConsent)).toBe(true)
		expect(reflector.get("PUBLIC", PisoCampController.prototype.recordConsent)).toBe(true)
		expect(
			Reflect.getMetadata(STRICT_THROTTLE_KEY, PisoCampController.prototype.recordConsent)
		).toBe(true)
		expect(
			Reflect.getMetadata(INTERCEPTORS_METADATA, PisoCampController.prototype.recordConsent)
		).toHaveLength(1)
		expect(
			Reflect.getMetadata(IDEMPOTENCY_REQUIREMENT_KEY, PisoCampController.prototype.recordConsent)
		).toEqual({ requestIdField: "id", requireActiveAccount: true })
	})

	it("derives the GET subject server-side and returns its active notice state", async () => {
		const request = { headers: { "x-device-pseudo-id": "AbCdEfGhIjKlMnOpQrSt_-" } }
		const subject = { devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" }
		subjectService.resolve.mockResolvedValue(subject)
		consentService.getStatus.mockResolvedValue({ purpose: "registration", state: "none" })

		await expect(controller.getConsent(request as never)).resolves.toEqual({
			purpose: "registration",
			state: "none",
		})
		expect(subjectService.resolve).toHaveBeenCalledWith(request)
		expect(consentService.getStatus).toHaveBeenCalledWith(subject, "registration")
	})

	it("derives the POST subject server-side and records the typed decision", async () => {
		const request = { headers: {}, session: { user: { id: "account-1" } } }
		const subject = { accountId: "account-1" }
		subjectService.resolve.mockResolvedValue(subject)
		consentService.record.mockResolvedValue({ id: "b3e8f099-a472-42c2-8e82-890446fe6411" })

		await expect(controller.recordConsent(request as never)).resolves.toEqual({
			id: "b3e8f099-a472-42c2-8e82-890446fe6411",
		})
		expect(subjectService.resolve).toHaveBeenCalledWith(request)
		expect(consentService.record).toHaveBeenCalledWith(
			subject,
			expect.objectContaining({
				id: "b3e8f099-a472-42c2-8e82-890446fe6411",
				purpose: "registration",
				decision: "granted",
			})
		)
	})

	it("maps a missing guest identity to an oRPC BAD_REQUEST instead of a 500", async () => {
		subjectService.resolve.mockRejectedValueOnce(
			new BadRequestException("A valid X-Device-Pseudo-Id header is required")
		)
		await expect(controller.getConsent({ headers: {} } as never)).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "A valid X-Device-Pseudo-Id header is required",
		})
	})

	it("maps a stale notice to an oRPC CONFLICT instead of a 500", async () => {
		subjectService.resolve.mockResolvedValueOnce({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" })
		consentService.record.mockRejectedValueOnce(
			new ConflictException("Privacy notice is no longer current")
		)
		await expect(controller.recordConsent({ headers: {} } as never)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Privacy notice is no longer current",
		})
	})

	it("maps a deactivated authenticated account to an oRPC UNAUTHORIZED", async () => {
		subjectService.resolve.mockRejectedValueOnce(
			new UnauthorizedException("Account is deactivated")
		)
		await expect(
			controller.recordConsent({ headers: {}, session: { user: { id: "account-1" } } } as never)
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
			message: "Account is deactivated",
		})
	})

	it("serves public defaults without a session", async () => {
		await expect(controller.getPublicConfig()).resolves.toEqual({
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
			survey_triggers: [],
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
