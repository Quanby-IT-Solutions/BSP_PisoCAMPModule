import { INTERCEPTORS_METADATA } from "@nestjs/common/constants"
import { Test } from "@nestjs/testing"
import { Logger } from "nestjs-pino"

import { IDEMPOTENCY_REQUIREMENT_KEY } from "@/shared/decorators/require-idempotency.decorator"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyService } from "@/shared/interceptors/idempotency.service"

import { AssetsController } from "./assets.controller"
import { AssetsService } from "./assets.service"

const itemId = "e7ac2493-c85b-4a13-b34c-a10149396214"
const assetId = "bbd598ad-3348-4d4f-9d1c-1266eaf8b17d"
const requestId = "2a8748ad-fbde-4b77-981c-64cf410fb3b5"
const file = new File(["asset"], "asset", { type: "model/gltf+json" })
const inputs = {
	list: { itemId },
	upload: { file, itemId, expectedVersionNo: 1, role: "animation", requestId },
	attach: { assetId, itemId, expectedVersionNo: 2, role: "animation", requestId },
	detach: { assetId, itemId, expectedVersionNo: 3, role: "animation", requestId },
	delete: { assetId, itemId, expectedVersionNo: 4, requestId },
} as const
const prepared = {
	file,
	bytes: Buffer.from("asset"),
	sha256: "d59386e0ae4355c48a18cbf5f62120b5806ab7d3a1d758e6f7bd8c1de0432fce",
	mediaType: "model/gltf+json" as const,
	byteLength: 5,
}

jest.mock("@orpc/nest", () => ({ Implement: () => () => undefined }))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
	implement: jest.fn((contract: string) => ({
		handler: (handler: (args: { input: unknown }) => unknown) =>
			handler({ input: inputs[contract as keyof typeof inputs] }),
	})),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			admin: {
				assets: {
					list: "list",
					upload: "upload",
					attach: "attach",
					detach: "detach",
					delete: "delete",
				},
			},
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({ Session: () => () => undefined }))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./asset-upload.interceptor", () => ({
	AssetUploadInterceptor: class AssetUploadInterceptor {},
	getPreparedAssetUpload: () => prepared,
}))

describe("AssetsController", () => {
	const service = {
		list: jest.fn(),
		upload: jest.fn(),
		attach: jest.fn(),
		detach: jest.fn(),
		delete: jest.fn(),
	}
	const idempotency = {
		execute: jest.fn((operation: { run: () => Promise<unknown> }) => operation.run()),
	}
	const logger = { error: jest.fn() }
	let controller: AssetsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [AssetsController],
			providers: [
				{ provide: AssetsService, useValue: service },
				{ provide: IdempotencyService, useValue: idempotency },
				{ provide: Logger, useValue: logger },
			],
		}).compile()
		controller = module.get(AssetsController)
		jest.clearAllMocks()
	})

	it("protects every route with the exact permission and mutation controls", () => {
		for (const name of ["list", "upload", "attach", "detach", "delete"] as const) {
			expect(
				Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AssetsController.prototype[name])
			).toEqual(["content.assets.upload"])
		}
		for (const name of ["upload", "attach", "detach", "delete"] as const) {
			expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, AssetsController.prototype[name])).toBe(true)
		}
		expect(
			Reflect.getMetadata(IDEMPOTENCY_REQUIREMENT_KEY, AssetsController.prototype.upload)
		).toBeUndefined()
		expect(
			Reflect.getMetadata(INTERCEPTORS_METADATA, AssetsController.prototype.upload)
		).toHaveLength(1)
		for (const name of ["attach", "detach", "delete"] as const) {
			expect(
				Reflect.getMetadata(IDEMPOTENCY_REQUIREMENT_KEY, AssetsController.prototype[name])
			).toEqual({
				requestIdField: "requestId",
				requireActiveAccount: true,
			})
			expect(
				Reflect.getMetadata(INTERCEPTORS_METADATA, AssetsController.prototype[name])
			).toHaveLength(1)
		}
	})

	it("uses the server digest and exact matching request UUID for upload idempotency", async () => {
		service.upload.mockResolvedValue({ currentVersionNo: 2 })
		const request = { headers: { "idempotency-key": requestId } }
		await controller.upload({ user: { id: "verified-actor" } } as never, request as never)
		expect(idempotency.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				authorId: "verified-actor",
				key: requestId,
				method: "POST",
				path: "/api/v1/admin/pisocamp/assets",
				input: {
					fileSha256: prepared.sha256,
					itemId,
					expectedVersionNo: 1,
					role: "animation",
					requestId,
				},
			})
		)
		expect(service.upload).toHaveBeenCalledWith(prepared, inputs.upload, "verified-actor")
	})

	it("rejects a mismatched upload key before idempotency or service execution", async () => {
		await expect(
			controller.upload(
				{ user: { id: "verified-actor" } } as never,
				{ headers: { "idempotency-key": "11111111-1111-4111-8111-111111111111" } } as never
			)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(idempotency.execute).not.toHaveBeenCalled()
		expect(service.upload).not.toHaveBeenCalled()
	})

	it("delegates list and JSON mutations with the verified session actor", async () => {
		service.list.mockResolvedValue({ attachments: [], available: [] })
		service.attach.mockResolvedValue({})
		service.detach.mockResolvedValue({})
		service.delete.mockResolvedValue({})
		await controller.list()
		await controller.attach({ user: { id: "actor" } } as never)
		await controller.detach({ user: { id: "actor" } } as never)
		await controller.delete({ user: { id: "actor" } } as never)
		expect(service.list).toHaveBeenCalledWith(itemId)
		expect(service.attach).toHaveBeenCalledWith(inputs.attach, "actor")
		expect(service.detach).toHaveBeenCalledWith(inputs.detach, "actor")
		expect(service.delete).toHaveBeenCalledWith(inputs.delete, "actor")
	})

	it("maps unknown failures to a fixed public error without logging request data", async () => {
		service.attach.mockRejectedValue(new Error("temporary path and filename sentinel"))
		await expect(controller.attach({ user: { id: "actor" } } as never)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Asset operation failed",
		})
		expect(logger.error).toHaveBeenCalledWith(
			{ operation: "attach", errorName: "Error" },
			"Unexpected asset operation failure"
		)
		expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/temporary path|filename sentinel/)
	})
})
