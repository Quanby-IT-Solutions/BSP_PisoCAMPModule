import { INTERCEPTORS_METADATA } from "@nestjs/common/constants"
import { Test } from "@nestjs/testing"
import { Logger } from "nestjs-pino"

import { IDEMPOTENCY_REQUIREMENT_KEY } from "@/shared/decorators/require-idempotency.decorator"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"

import { ContentWorkflowService } from "./content-workflow.service"
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
const workflowInputs = {
	reviewQueue: { page: 1, limit: 20 },
	review: { itemId: updateInput.itemId },
	submit: {
		itemId: updateInput.itemId,
		requestId: "057a1598-182f-418d-9974-d4ce6e527b99",
		expectedVersionNo: 2,
		comments: "Ready for review",
	},
	approve: {
		itemId: updateInput.itemId,
		requestId: "17d17b9f-7560-407e-9167-c0591ed922ac",
		expectedVersionNo: 3,
		comments: "Verified against the source",
	},
	reject: {
		itemId: updateInput.itemId,
		requestId: "3c1a46da-6abc-4bc9-b38a-a3e38a2ae743",
		expectedVersionNo: 3,
		comments: "Please correct the attribution",
	},
	publish: {
		itemId: updateInput.itemId,
		requestId: "4b2b57b2-b41e-478c-a74e-bc64301a3380",
		expectedVersionNo: 4,
		comments: "Approved for release",
	},
} as const

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
				input: (
					{
						create: createInput,
						update: updateInput,
						get: { itemId: updateInput.itemId },
						list: { page: 1, limit: 20 },
						...workflowInputs,
					} as Record<string, unknown>
				)[contract],
			}),
	})),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			admin: {
				content: {
					list: "list",
					get: "get",
					create: "create",
					update: "update",
					reviewQueue: "reviewQueue",
					review: "review",
					submit: "submit",
					approve: "approve",
					reject: "reject",
					publish: "publish",
				},
			},
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({ Session: () => () => undefined }))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

describe("ContentController", () => {
	const service = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn() }
	const workflow = {
		listReviewQueue: jest.fn(),
		getReviewDetail: jest.fn(),
		transition: jest.fn(),
	}
	const logger = { error: jest.fn() }
	let controller: ContentController
	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ContentController],
			providers: [
				{ provide: ContentService, useValue: service },
				{ provide: ContentWorkflowService, useValue: workflow },
				{ provide: Logger, useValue: logger },
			],
		}).compile()
		controller = module.get(ContentController)
		jest.clearAllMocks()
	})

	it("protects workflow reads and mutations with exact permission and mutation metadata", () => {
		const prototype = ContentController.prototype as unknown as Record<string, object>
		const permissions = {
			reviewQueue: "content.items.approve",
			reviewContent: "content.items.approve",
			submitContent: "content.items.submit",
			approveContent: "content.items.approve",
			rejectContent: "content.items.approve",
			publishContent: "content.items.publish",
		} as const

		for (const [name, permission] of Object.entries(permissions)) {
			expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, prototype[name]!)).toEqual([permission])
		}

		for (const name of ["submitContent", "approveContent", "rejectContent", "publishContent"]) {
			expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, prototype[name]!)).toBe(true)
			expect(Reflect.getMetadata(IDEMPOTENCY_REQUIREMENT_KEY, prototype[name]!)).toEqual({
				requestIdField: "requestId",
				requireActiveAccount: true,
			})
			expect(Reflect.getMetadata(INTERCEPTORS_METADATA, prototype[name]!)).toHaveLength(1)
		}

		for (const name of ["reviewQueue", "reviewContent"]) {
			expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, prototype[name]!)).toBeUndefined()
			expect(Reflect.getMetadata(IDEMPOTENCY_REQUIREMENT_KEY, prototype[name]!)).toBeUndefined()
			expect(Reflect.getMetadata(INTERCEPTORS_METADATA, prototype[name]!)).toBeUndefined()
		}
	})

	it("delegates all six workflow procedures with the verified session actor", async () => {
		workflow.listReviewQueue.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 })
		workflow.getReviewDetail.mockResolvedValue({ id: updateInput.itemId })
		workflow.transition.mockResolvedValue({ id: updateInput.itemId })
		const actorId = "verified-workflow-actor"
		const dynamicController = controller as unknown as Record<
			string,
			(session?: { user: { id: string } }) => Promise<unknown>
		>

		await dynamicController.reviewQueue!()
		await dynamicController.reviewContent!()
		for (const name of ["submit", "approve", "reject", "publish"] as const) {
			await dynamicController[`${name}Content`]!({ user: { id: actorId } })
		}

		expect(workflow.listReviewQueue).toHaveBeenCalledWith(workflowInputs.reviewQueue)
		expect(workflow.getReviewDetail).toHaveBeenCalledWith(workflowInputs.review.itemId)
		for (const action of ["submit", "approve", "reject", "publish"] as const) {
			expect(workflow.transition).toHaveBeenCalledWith(action, workflowInputs[action], actorId)
		}
	})

	it("preserves typed workflow errors without redundant diagnostic logging", async () => {
		const { ORPCError } = jest.requireMock("@orpc/server") as {
			ORPCError: new (code: string, options?: { message?: string }) => Error & { code: string }
		}
		const dynamicController = controller as unknown as Record<
			string,
			(session?: { user: { id: string } }) => Promise<unknown>
		>

		workflow.getReviewDetail.mockRejectedValueOnce(
			new ORPCError("NOT_FOUND", { message: "Content item not found" })
		)
		await expect(dynamicController.reviewContent!()).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Content item not found",
		})
		expect(logger.error).not.toHaveBeenCalled()
	})

	it("logs an unknown workflow failure once with safe operation context and the original error", async () => {
		const dynamicController = controller as unknown as Record<
			string,
			(session?: { user: { id: string } }) => Promise<unknown>
		>
		const cause = new Error("socket closed")
		const failure = new Error(
			"duplicate key value violates content_bundle_rebuild_request_unique",
			{ cause }
		)

		workflow.transition.mockRejectedValueOnce(failure)
		await expect(
			dynamicController.publishContent!({ user: { id: "verified-workflow-actor" } })
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Content operation failed",
		})
		expect(logger.error).toHaveBeenCalledTimes(1)
		expect(logger.error).toHaveBeenCalledWith(
			{ operation: "publish", err: failure },
			"Unexpected content operation failure"
		)
		expect((logger.error.mock.calls[0]?.[0] as { err: Error }).err.stack).toBe(failure.stack)
		expect((logger.error.mock.calls[0]?.[0] as { err: Error }).err.cause).toBe(cause)
		expect(Object.keys(logger.error.mock.calls[0]?.[0] as object).sort()).toEqual([
			"err",
			"operation",
		])
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
