import { PreconditionFailedException, type ExecutionContext } from "@nestjs/common"
import { type Reflector } from "@nestjs/core"

import { type PisoCampConsentSubjectService } from "@/modules/v1/pisocamp/pisocamp-consent-subject.service"
import { type PisoCampConsentService } from "@/modules/v1/pisocamp/pisocamp-consent.service"
import { REQUIRED_CONSENT_KEY } from "@/shared/decorators/require-consent.decorator"

import { ConsentGuard } from "./consent.guard"

jest.mock("@/modules/v1/pisocamp/pisocamp-consent-subject.service", () => ({
	PisoCampConsentSubjectService: class PisoCampConsentSubjectService {},
}))
jest.mock("@/modules/v1/pisocamp/pisocamp-consent.service", () => ({
	PisoCampConsentService: class PisoCampConsentService {},
}))

const request = { headers: { "x-device-pseudo-id": "AbCdEfGhIjKlMnOpQrSt_-" } }
const handler = () => undefined
const controller = class ConsentProtectedController {}
const context = {
	getHandler: () => handler,
	getClass: () => controller,
	switchToHttp: () => ({ getRequest: () => request }),
} as unknown as ExecutionContext

describe("ConsentGuard", () => {
	const reflector = { getAllAndOverride: jest.fn() }
	const subjectService = { resolve: jest.fn() }
	const consentService = { getStatus: jest.fn() }
	let guard: ConsentGuard

	beforeEach(() => {
		jest.clearAllMocks()
		guard = new ConsentGuard(
			reflector as unknown as Reflector,
			subjectService as unknown as PisoCampConsentSubjectService,
			consentService as unknown as PisoCampConsentService
		)
		subjectService.resolve.mockResolvedValue({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" })
	})

	it("is inert when no consent metadata is present", async () => {
		reflector.getAllAndOverride.mockReturnValue(undefined)
		await expect(guard.canActivate(context)).resolves.toBe(true)
		expect(subjectService.resolve).not.toHaveBeenCalled()
		expect(consentService.getStatus).not.toHaveBeenCalled()
	})

	it("allows only a current grant for the required purpose", async () => {
		reflector.getAllAndOverride.mockReturnValue("survey")
		consentService.getStatus.mockResolvedValue({ purpose: "survey", state: "granted" })

		await expect(guard.canActivate(context)).resolves.toBe(true)
		expect(consentService.getStatus).toHaveBeenCalledWith(
			{ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" },
			"survey"
		)
	})

	it.each(["none", "declined", "withdrawn", "requires_reconsent"])(
		"fails with a safe precondition response for %s",
		async state => {
			reflector.getAllAndOverride.mockReturnValue("registration")
			consentService.getStatus.mockResolvedValue({ purpose: "registration", state })
			const error = await guard.canActivate(context).catch(cause => cause)
			expect(error).toBeInstanceOf(PreconditionFailedException)
			expect(error.getStatus()).toBe(412)
			expect(error.getResponse()).toEqual({
				message: "Current consent required",
				state,
				purpose: "registration",
			})
			expect(JSON.stringify(error.getResponse())).not.toContain("AbCdEfGhIjKlMnOpQrSt_-")
		}
	)

	it("reads handler metadata before class metadata", async () => {
		reflector.getAllAndOverride.mockReturnValue("demographic_analytics")
		consentService.getStatus.mockResolvedValue({
			purpose: "demographic_analytics",
			state: "granted",
		})
		await guard.canActivate(context)
		expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRED_CONSENT_KEY, [
			context.getHandler(),
			context.getClass(),
		])
	})
})
