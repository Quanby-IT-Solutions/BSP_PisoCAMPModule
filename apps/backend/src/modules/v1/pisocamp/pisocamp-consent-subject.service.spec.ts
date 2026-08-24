import { BadRequestException, UnauthorizedException } from "@nestjs/common"

import { type AccountAccessService } from "@/common/rbac/account-access.service"

import { PisoCampConsentSubjectService } from "./pisocamp-consent-subject.service"

const mockGetSession = jest.fn().mockResolvedValue(null)
jest.mock("better-auth/node", () => ({ fromNodeHeaders: jest.fn(headers => headers) }))
jest.mock("@repo/auth", () => ({
	getAuth: jest.fn(() => ({ api: { getSession: mockGetSession } })),
}))

describe("PisoCampConsentSubjectService", () => {
	const accountAccess = { isActive: jest.fn().mockResolvedValue(true) }
	let service: PisoCampConsentSubjectService

	beforeEach(() => {
		mockGetSession.mockReset()
		mockGetSession.mockResolvedValue(null)
		accountAccess.isActive.mockReset()
		accountAccess.isActive.mockResolvedValue(true)
		service = new PisoCampConsentSubjectService(accountAccess as unknown as AccountAccessService)
	})

	it("derives the account only from the verified attached session and ignores spoof headers", async () => {
		const request = {
			headers: { "x-device-pseudo-id": "AbCdEfGhIjKlMnOpQrSt_-" },
			session: { user: { id: "account-1" } },
			user: { id: "spoofed-fallback" },
		}
		await expect(service.resolve(request)).resolves.toEqual({ accountId: "account-1" })
		expect(accountAccess.isActive).toHaveBeenCalledWith("account-1")
	})

	it("resolves a verified session from headers when auth middleware has not attached it", async () => {
		mockGetSession.mockResolvedValue({ user: { id: "resolved-account" } })
		const request = { headers: { cookie: "session=safe-test-token" } }
		await expect(service.resolve(request)).resolves.toEqual({ accountId: "resolved-account" })
		expect(request).toMatchObject({
			session: { user: { id: "resolved-account" } },
			user: { id: "resolved-account" },
		})
	})

	it("rejects a deactivated authenticated account", async () => {
		accountAccess.isActive.mockResolvedValue(false)
		await expect(
			service.resolve({ headers: {}, session: { user: { id: "deactivated" } } })
		).rejects.toBeInstanceOf(UnauthorizedException)
	})

	it("accepts an exact F1 guest identity after session resolution returns anonymous", async () => {
		await expect(
			service.resolve({ headers: { "x-device-pseudo-id": "AbCdEfGhIjKlMnOpQrSt_-" } })
		).resolves.toEqual({ devicePseudoId: "AbCdEfGhIjKlMnOpQrSt_-" })
	})

	it.each([
		["missing", undefined],
		["short", "short"],
		["padded", "AbCdEfGhIjKlMnOpQrSt_-= "],
		["multiple", ["AbCdEfGhIjKlMnOpQrSt_-", "ZbCdEfGhIjKlMnOpQrSt_-"]],
	])("rejects a %s guest identity without echoing it", async (_label, value) => {
		const result = service
			.resolve({ headers: { "x-device-pseudo-id": value } })
			.catch(error => error)
		const error = await result
		expect(error).toBeInstanceOf(BadRequestException)
		expect(String(error.message)).not.toContain(String(value))
	})
})
