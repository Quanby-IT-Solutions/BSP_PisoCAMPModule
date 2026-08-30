import { HttpStatus, SetMetadata } from "@nestjs/common"
import { PATH_METADATA } from "@nestjs/common/constants"
import { Reflector } from "@nestjs/core"
import { createHash } from "node:crypto"
import { of } from "rxjs"

import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"

import {
	BundleController,
	BundleManifestHttpInterceptor,
	BundleResourceController,
	ifNoneMatchMatches,
	parseSingleByteRange,
} from "./bundle.controller"

jest.mock("@orpc/nest", () => ({
	Implement: (contract: { path: string }) => SetMetadata(PATH_METADATA, contract.path),
	implement: () => ({
		handler: (handler: (args: { context: unknown; input: unknown }) => unknown) => ({
			"~orpc": { handler },
		}),
	}),
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		readonly code: string
		constructor(code: string, options?: { message?: string }) {
			super(options?.message)
			this.code = code
		}
	},
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			bundle: {
				manifest: { get: { path: "/v1/pisocamp/bundle/manifest" } },
			},
		},
	},
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => SetMetadata("PUBLIC", true),
}))

const ENVELOPE = {
	schemaVersion: 1 as const,
	algorithm: "Ed25519" as const,
	keyId: "ce1-test-v1",
	payload: "eyJzY2hlbWFWZXJzaW9uIjoxfQ",
	signature: "A".repeat(86),
}

function createResponse() {
	const response = {
		statusCode: 200,
		headers: {} as Record<string, string>,
		body: undefined as unknown,
		setHeader(name: string, value: string | number) {
			this.headers[name.toLowerCase()] = String(value)
			return this
		},
		status(code: number) {
			this.statusCode = code
			return this
		},
		json(value: unknown) {
			this.body = value
			return this
		},
		send(value?: unknown) {
			this.body = value
			return this
		},
		end() {
			return this
		},
	}
	return response
}

describe("bundle public HTTP helpers", () => {
	it.each([
		[undefined, 10, null],
		["bytes=0-3", 10, { start: 0, end: 3 }],
		["bytes=4-", 10, { start: 4, end: 9 }],
		["bytes=-4", 10, { start: 6, end: 9 }],
		["bytes=7-99", 10, { start: 7, end: 9 }],
	])("parses %s against %i bytes", (header, length, expected) => {
		expect(parseSingleByteRange(header, length)).toEqual(expected)
	})

	it.each([
		["bytes=0-1,3-4", 10],
		["items=0-1", 10],
		["bytes=", 10],
		["bytes=-0", 10],
		["bytes=10-", 10],
		["bytes=5-4", 10],
		["bytes=0-0", 0],
	])("rejects unsupported or unsatisfiable range %s", (header, length) => {
		expect(parseSingleByteRange(header, length)).toBe("unsatisfiable")
	})

	it("uses weak comparison safely across validator lists and wildcard", () => {
		const etag = '"abc123"'
		expect(ifNoneMatchMatches(undefined, etag)).toBe(false)
		expect(ifNoneMatchMatches('"other", "abc123"', etag)).toBe(true)
		expect(ifNoneMatchMatches("*", etag)).toBe(true)
		expect(ifNoneMatchMatches('W/"abc123"', etag)).toBe(true)
		expect(ifNoneMatchMatches('"other", W/"abc123"', etag)).toBe(true)
		expect(ifNoneMatchMatches('W/"other"', etag)).toBe(false)
		expect(ifNoneMatchMatches('"abc123", broken\"quote', etag)).toBe(false)
	})
})

describe("BundleController", () => {
	it("is contract-routed, anonymous, and opts only the manifest into strict throttling", () => {
		const reflector = new Reflector()
		const manifest = BundleController.prototype.getManifest
		const resource = BundleResourceController.prototype.getResource
		const headResource = BundleResourceController.prototype.headResource

		expect(Reflect.getMetadata(PATH_METADATA, manifest)).toBe("/v1/pisocamp/bundle/manifest")
		expect(reflector.get(STRICT_THROTTLE_KEY, manifest)).toBe(true)
		expect(reflector.get(STRICT_THROTTLE_KEY, resource)).toBeUndefined()
		expect(reflector.get(STRICT_THROTTLE_KEY, headResource)).toBeUndefined()
		expect(Reflect.getMetadata("PUBLIC", manifest)).toBe(true)
		expect(Reflect.getMetadata("PUBLIC", resource)).toBe(true)
		expect(Reflect.getMetadata("PUBLIC", headResource)).toBe(true)
	})

	it("returns the strict envelope after the HTTP interceptor prepares the response", async () => {
		const repository = { readCurrentReadyEnvelope: jest.fn().mockResolvedValue(ENVELOPE) }
		const controller = new BundleController(repository as never)
		const response = createResponse()
		const request = { headers: {} }
		const interceptor = new BundleManifestHttpInterceptor(repository as never)
		const execution = {
			switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
		}
		const stream = await interceptor.intercept(execution as never, { handle: () => of(true) })
		await new Promise<void>((resolve, reject) =>
			stream.subscribe({ complete: resolve, error: reject })
		)
		const procedure = await controller.getManifest(request as never)
		const callable = procedure as unknown as {
			"~orpc": { handler: (input: unknown) => Promise<unknown> }
		}
		const result = await callable["~orpc"].handler({
			input: undefined,
			context: { request, response },
		})
		const serialized = JSON.stringify(ENVELOPE)
		const digest = createHash("sha256").update(serialized).digest("hex")

		expect(result).toEqual(ENVELOPE)
		expect(response.headers).toMatchObject({
			"cache-control": "no-cache",
			"etag": `"${digest}"`,
		})
	})

	it("returns a bodyless 304 for a matching validator", async () => {
		const repository = { readCurrentReadyEnvelope: jest.fn().mockResolvedValue(ENVELOPE) }
		const response = createResponse()
		const etag = `"${createHash("sha256").update(JSON.stringify(ENVELOPE)).digest("hex")}"`
		const interceptor = new BundleManifestHttpInterceptor(repository as never)
		const execution = {
			switchToHttp: () => ({
				getRequest: () => ({ headers: { "if-none-match": etag } }),
				getResponse: () => response,
			}),
		}
		const stream = await interceptor.intercept(execution as never, { handle: () => of(true) })
		let emissionCount = 0
		await new Promise<void>((resolve, reject) =>
			stream.subscribe({ next: () => (emissionCount += 1), complete: resolve, error: reject })
		)

		expect(emissionCount).toBe(1)
		expect(response.statusCode).toBe(HttpStatus.NOT_MODIFIED)
		expect(response.body).toBeUndefined()
	})

	it("returns the same bodyless 304 for a weak current validator in a list", async () => {
		const repository = { readCurrentReadyEnvelope: jest.fn().mockResolvedValue(ENVELOPE) }
		const response = createResponse()
		const etag = `"${createHash("sha256").update(JSON.stringify(ENVELOPE)).digest("hex")}"`
		const interceptor = new BundleManifestHttpInterceptor(repository as never)
		const execution = {
			switchToHttp: () => ({
				getRequest: () => ({ headers: { "if-none-match": `"other", W/${etag}` } }),
				getResponse: () => response,
			}),
		}
		const stream = await interceptor.intercept(execution as never, { handle: () => of(true) })
		await new Promise<void>((resolve, reject) =>
			stream.subscribe({ complete: resolve, error: reject })
		)

		expect(response.statusCode).toBe(HttpStatus.NOT_MODIFIED)
		expect(response.body).toBeUndefined()
		expect(response.headers).toMatchObject({
			"cache-control": "no-cache",
			etag,
		})
	})

	it("maps unavailable and raw database failures to one safe public error without logging details", async () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined)
		for (const failure of [null, new Error("actor comment internal-key raw-db-password")]) {
			const repository = {
				readCurrentReadyEnvelope:
					failure instanceof Error
						? jest.fn().mockRejectedValue(failure)
						: jest.fn().mockResolvedValue(failure),
			}
			const interceptor = new BundleManifestHttpInterceptor(repository as never)
			const execution = {
				switchToHttp: () => ({
					getRequest: () => ({ headers: {} }),
					getResponse: () => createResponse(),
				}),
			}

			await expect(
				interceptor.intercept(execution as never, { handle: () => of(true) })
			).rejects.toEqual(
				expect.objectContaining({
					message: "Bundle manifest is temporarily unavailable",
				})
			)
		}
		expect(consoleError).not.toHaveBeenCalled()
		consoleError.mockRestore()
	})
})

describe("BundleResourceController", () => {
	const bytes = Buffer.from("0123456789", "utf8")
	const sha256 = createHash("sha256").update(bytes).digest("hex")

	it("ignores Range on HEAD and returns full-representation headers without a body", async () => {
		const store = {
			readPublicByDigest: jest.fn().mockResolvedValue({
				sha256,
				byteLength: bytes.byteLength,
				mediaType: "application/json",
				bytes,
			}),
		}
		const controller = new BundleResourceController(store as never)
		const response = createResponse()

		await controller.headResource(sha256, response as never)

		expect(response.statusCode).toBe(HttpStatus.OK)
		expect(response.body).toBeUndefined()
		expect(response.headers).toMatchObject({
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=31536000, immutable",
			"content-length": String(bytes.byteLength),
			"content-type": "application/json",
			"etag": `"${sha256}"`,
			"x-content-type-options": "nosniff",
		})
		expect(response.headers["content-range"]).toBeUndefined()
	})

	it("keeps invalid, unknown, and failed HEAD resource lookups bounded", async () => {
		const invalidStore = { readPublicByDigest: jest.fn() }
		const invalidController = new BundleResourceController(invalidStore as never)
		const invalidResponse = createResponse()
		await invalidController.headResource("INVALID", invalidResponse as never)
		expect(invalidResponse.statusCode).toBe(HttpStatus.NOT_FOUND)
		expect(invalidResponse.body).toBeUndefined()
		expect(invalidStore.readPublicByDigest).not.toHaveBeenCalled()

		const unknownController = new BundleResourceController({
			readPublicByDigest: jest.fn().mockResolvedValue(null),
		} as never)
		const unknownResponse = createResponse()
		await unknownController.headResource("f".repeat(64), unknownResponse as never)
		expect(unknownResponse.statusCode).toBe(HttpStatus.NOT_FOUND)
		expect(unknownResponse.body).toBeUndefined()

		const failedController = new BundleResourceController({
			readPublicByDigest: jest.fn().mockRejectedValue(new Error("raw-storage-sentinel")),
		} as never)
		await expect(
			failedController.headResource("f".repeat(64), createResponse() as never)
		).rejects.toEqual(
			expect.objectContaining({ message: "Bundle resource is temporarily unavailable" })
		)
	})

	it.each([
		[undefined, HttpStatus.OK, bytes, undefined],
		["bytes=2-5", HttpStatus.PARTIAL_CONTENT, Buffer.from("2345"), "bytes 2-5/10"],
		["bytes=7-", HttpStatus.PARTIAL_CONTENT, Buffer.from("789"), "bytes 7-9/10"],
		["bytes=-3", HttpStatus.PARTIAL_CONTENT, Buffer.from("789"), "bytes 7-9/10"],
	])("serves an exact %s response", async (range, status, expected, contentRange) => {
		const store = {
			readPublicByDigest: jest.fn().mockResolvedValue({
				sha256,
				byteLength: bytes.byteLength,
				mediaType: "application/json",
				bytes,
			}),
		}
		const controller = new BundleResourceController(store as never)
		const response = createResponse()

		await controller.getResource(sha256, range, response as never)

		expect(response.statusCode).toBe(status)
		expect(response.body).toEqual(expected)
		expect(response.headers).toMatchObject({
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=31536000, immutable",
			"content-length": String(expected.byteLength),
			"content-type": "application/json",
			"etag": `"${sha256}"`,
			"x-content-type-options": "nosniff",
		})
		expect(response.headers["content-range"]).toBe(contentRange)
	})

	it.each(["bytes=0-1,3-4", "units=0-1", "bytes=-0", "bytes=10-"])(
		"returns safe 416 for %s",
		async range => {
			const store = {
				readPublicByDigest: jest.fn().mockResolvedValue({
					sha256,
					byteLength: bytes.byteLength,
					mediaType: "application/json",
					bytes,
				}),
			}
			const controller = new BundleResourceController(store as never)
			const response = createResponse()

			await controller.getResource(sha256, range, response as never)

			expect(response.statusCode).toBe(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
			expect(response.headers["content-range"]).toBe("bytes */10")
			expect(response.body).toBeUndefined()
		}
	)

	it.each(["ABC", "a".repeat(63), "g".repeat(64)])(
		"returns indistinguishable 404 without consulting storage for invalid digest %s",
		async digest => {
			const store = { readPublicByDigest: jest.fn() }
			const controller = new BundleResourceController(store as never)
			const response = createResponse()

			await controller.getResource(digest, undefined, response as never)

			expect(response.statusCode).toBe(HttpStatus.NOT_FOUND)
			expect(store.readPublicByDigest).not.toHaveBeenCalled()
		}
	)

	it("returns the same bodyless 404 for a valid unknown digest", async () => {
		const store = { readPublicByDigest: jest.fn().mockResolvedValue(null) }
		const controller = new BundleResourceController(store as never)
		const response = createResponse()

		await controller.getResource("f".repeat(64), undefined, response as never)

		expect(response.statusCode).toBe(HttpStatus.NOT_FOUND)
		expect(response.body).toBeUndefined()
	})

	it("masks raw storage failures and does not log them locally", async () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined)
		const store = {
			readPublicByDigest: jest
				.fn()
				.mockRejectedValue(new Error("private-key cookie actor comment internal-storage-key")),
		}
		const controller = new BundleResourceController(store as never)

		await expect(
			controller.getResource("f".repeat(64), undefined, createResponse() as never)
		).rejects.toEqual(
			expect.objectContaining({
				message: "Bundle resource is temporarily unavailable",
			})
		)
		expect(consoleError).not.toHaveBeenCalled()
		consoleError.mockRestore()
	})
})
