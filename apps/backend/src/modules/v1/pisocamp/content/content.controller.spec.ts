import { INTERCEPTORS_METADATA } from "@nestjs/common/constants"
import { Test } from "@nestjs/testing"

import { IDEMPOTENCY_REQUIREMENT_KEY } from "@/shared/decorators/require-idempotency.decorator"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"

import { ContentController } from "./content.controller"
import { ContentService } from "./content.service"

const createInput = {
	requestId: "2a8748ad-fbde-4b77-981c-64cf410fb3b5",
	content: { contentType: "advisory", title: "Title", summary: "Summary", body: "Body" },
	relatedLinks: [],
}
const updateInput = {
	...createInput,
	itemId: "e7ac2493-c85b-4a13-b34c-a10149396214",
	expectedVersionNo: 1,
}

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
					contract === "create"
						? createInput
						: contract === "update"
							? updateInput
							: contract === "get"
								? { itemId: updateInput.itemId }
								: { page: 1, limit: 20 },
			}),
	})),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			admin: { content: { list: "list", get: "get", create: "create", update: "update" } },
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({ Session: () => () => undefined }))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

describe("ContentController", () => {
	const service = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn() }
	let controller: ContentController
	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ContentController],
			providers: [{ provide: ContentService, useValue: service }],
		}).compile()
		controller = module.get(ContentController)
		jest.clearAllMocks()
	})

	it("protects all routes and gives both mutations strict idempotency metadata", () => {
		for (const name of ["listContent", "getContent", "createContent", "updateContent"] as const) {
			expect(
				Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ContentController.prototype[name])
			).toEqual(["content.items.edit"])
		}
		for (const name of ["createContent", "updateContent"] as const) {
			expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, ContentController.prototype[name])).toBe(true)
			expect(
				Reflect.getMetadata(IDEMPOTENCY_REQUIREMENT_KEY, ContentController.prototype[name])
			).toEqual({ requestIdField: "requestId", requireActiveAccount: true })
			expect(
				Reflect.getMetadata(INTERCEPTORS_METADATA, ContentController.prototype[name])
			).toHaveLength(1)
		}
	})

	it("derives the actor only from the verified session for create and edit", async () => {
		service.create.mockResolvedValue({ id: "created" })
		service.update.mockResolvedValue({ id: "updated" })
		const session = { user: { id: "verified-actor" } } as never
		await controller.createContent(session)
		await controller.updateContent(session)
		expect(service.create).toHaveBeenCalledWith(createInput, "verified-actor")
		expect(service.update).toHaveBeenCalledWith(updateInput, "verified-actor")
	})
})
