import {
	CanActivate,
	Controller,
	ExecutionContext,
	Get,
	INestApplication,
	Post,
	Req,
	UseGuards,
	UseInterceptors,
} from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { existsSync } from "node:fs"
import * as fileSystem from "node:fs/promises"
import { request as httpRequest, type Server } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname } from "node:path"
import { deflateSync } from "node:zlib"
import request from "supertest"

import * as filePolicy from "./asset-file-policy"
import {
	ASSET_UPLOAD_DIRECTORY_REMOVER,
	AssetUploadInterceptor,
	getPreparedAssetUpload,
} from "./asset-upload.interceptor"

const crc32 = (bytes: Buffer) => {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
	}
	return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data = Buffer.alloc(0)) => {
	const name = Buffer.from(type, "ascii")
	const chunk = Buffer.alloc(12 + data.length)
	chunk.writeUInt32BE(data.length, 0)
	name.copy(chunk, 4)
	data.copy(chunk, 8)
	chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
	return chunk
}

const png = () => {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(1, 0)
	ihdr.writeUInt32BE(1, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(Buffer.alloc(5))),
		pngChunk("IEND"),
	])
}

const validFields = {
	itemId: "bb303323-2055-4532-8497-1daf9911315b",
	expectedVersionNo: "3",
	role: "obverse",
	requestId: "ea4cb048-e51b-49ab-b9b4-e9813dc70cb2",
}

class DenyGuard implements CanActivate {
	canActivate(_context: ExecutionContext) {
		return false
	}
}

@Controller("task4-assets")
class Task4AssetController {
	@Post("upload")
	@UseInterceptors(AssetUploadInterceptor)
	upload(@Req() request: Record<string, unknown>) {
		const prepared = getPreparedAssetUpload(request)
		const rawFile = request.file as Record<string, unknown> | undefined
		return {
			bodyFile: (request.body as { file: File }).file instanceof File,
			fileName: prepared.file.name,
			fileType: prepared.file.type,
			keys: Object.keys(prepared).sort(),
			pathExistsAtHandler: capturedPaths.some(path => existsSync(path)),
			rawFilePresent: "file" in request,
			rawFileKeys: rawFile ? Object.keys(rawFile).sort() : [],
		}
	}

	@Post("downstream-error")
	@UseInterceptors(AssetUploadInterceptor)
	downstreamError() {
		throw new Error("downstream test failure")
	}

	@Post("denied")
	@UseGuards(DenyGuard)
	@UseInterceptors(AssetUploadInterceptor)
	denied() {
		return { unreachable: true }
	}

	@Get("health")
	health() {
		return { ok: true }
	}
}

let capturedPaths: string[] = []
let removeDirectory: (path: string) => Promise<void> = path =>
	fileSystem.rm(path, { recursive: true, force: true })

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, reject, resolve }
}

function upload(agent: ReturnType<typeof request>, path = "/task4-assets/upload") {
	let test = agent.post(path)
	for (const [key, value] of Object.entries(validFields)) test = test.field(key, value)
	return test.attach("file", png(), { filename: "private-name.png", contentType: "text/plain" })
}

describe("AssetUploadInterceptor", () => {
	let app: INestApplication
	let agent: ReturnType<typeof request>
	let prepareSpy: jest.SpyInstance

	beforeAll(async () => {
		const realPrepare = filePolicy.prepareAssetUpload
		prepareSpy = jest
			.spyOn(filePolicy, "prepareAssetUpload")
			.mockImplementation(async (path, role) => {
				capturedPaths.push(path)
				return realPrepare(path, role)
			})
		const moduleRef = await Test.createTestingModule({
			controllers: [Task4AssetController],
			providers: [
				AssetUploadInterceptor,
				DenyGuard,
				{
					provide: ASSET_UPLOAD_DIRECTORY_REMOVER,
					useValue: (path: string) => removeDirectory(path),
				},
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(false)
		await app.init()
		agent = request(app.getHttpServer() as Server)
	})

	beforeEach(() => {
		capturedPaths = []
		removeDirectory = path => fileSystem.rm(path, { recursive: true, force: true })
	})

	afterAll(async () => {
		prepareSpy.mockRestore()
		await app.close()
	})

	it("uses private random names, prepares canonical metadata, and removes bytes before the handler", async () => {
		const response = await upload(agent).expect(201)

		expect(response.body).toEqual({
			bodyFile: true,
			fileName: "asset",
			fileType: "image/png",
			keys: ["byteLength", "bytes", "file", "mediaType", "sha256"],
			pathExistsAtHandler: false,
			rawFilePresent: false,
			rawFileKeys: [],
		})
		expect(capturedPaths).toHaveLength(1)
		expect(dirname(dirname(capturedPaths[0]!))).toBe(tmpdir())
		expect(basename(dirname(capturedPaths[0]!))).toMatch(/^pisocamp-asset-upload-[A-Za-z0-9_-]+$/)
		expect(basename(capturedPaths[0]!)).toMatch(/^[a-f0-9]{64}$/)
		expect(capturedPaths[0]).not.toContain("private-name")
	})

	it("allows at most six scalar fields of at most 1 KiB", async () => {
		let accepted = agent.post("/task4-assets/upload")
		for (const [key, value] of Object.entries(validFields)) accepted = accepted.field(key, value)
		await accepted
			.field("contextA", "a".repeat(1024))
			.field("contextB", "b")
			.attach("file", png(), "ignored.png")
			.expect(201)

		let tooMany = agent.post("/task4-assets/upload")
		for (const [key, value] of Object.entries(validFields)) tooMany = tooMany.field(key, value)
		const tooManyResponse = await tooMany
			.field("contextA", "a")
			.field("contextB", "b")
			.field("contextC", "c")
			.attach("file", png(), "secret-overflow.png")
			.expect(400)
		expect(tooManyResponse.text).not.toContain("secret-overflow")

		const tooLargeField = await agent
			.post("/task4-assets/upload")
			.field("role", "r".repeat(1025))
			.attach("file", png(), "secret-field.png")
			.expect(400)
		expect(tooLargeField.text).not.toContain("secret-field")
	})

	it("accepts exactly one file in the canonical field and rejects 50 MiB plus one", async () => {
		const extraFile = await agent
			.post("/task4-assets/upload")
			.field("role", "obverse")
			.attach("file", png(), "first-secret.png")
			.attach("file", png(), "second-secret.png")
			.expect(400)
		expect(extraFile.text).not.toContain("secret")

		const exactCeiling = Buffer.alloc(52_428_800, 0x20)
		Buffer.from(JSON.stringify({ asset: { version: "2.0" } })).copy(exactCeiling)
		await agent
			.post("/task4-assets/upload")
			.field("role", "animation")
			.attach("file", exactCeiling, "exact-ceiling-secret.gltf")
			.expect(201)

		const oversized = Buffer.alloc(52_428_801)
		png().copy(oversized)
		const tooLarge = await agent
			.post("/task4-assets/upload")
			.field("role", "obverse")
			.attach("file", oversized, "large-secret.png")
			.expect(413)
		expect(tooLarge.text).not.toContain("large-secret")
	})

	it("runs after guards, so denied requests never create multipart files", async () => {
		await agent
			.post("/task4-assets/denied")
			.attach("file", Buffer.from("not-even-an-asset"), "denied-secret.png")
			.expect(403)
		expect(capturedPaths).toHaveLength(0)
	})

	it.each([
		["validation failure", "/task4-assets/upload", Buffer.from("malformed")],
		["downstream failure", "/task4-assets/downstream-error", png()],
	] as const)("cleans private disk bytes after %s", async (_, path, bytes) => {
		let pending = agent.post(path)
		for (const [key, value] of Object.entries(validFields)) pending = pending.field(key, value)
		await pending
			.attach("file", bytes, "cleanup-secret.png")
			.expect(path.endsWith("error") ? 500 : 400)
		expect(capturedPaths).toHaveLength(1)
		expect(capturedPaths.every(captured => !existsSync(captured))).toBe(true)
	})

	async function abortPartialUpload() {
		if (!(app.getHttpServer() as Server).listening) await app.listen(0, "127.0.0.1")
		const address = app.getHttpServer().address() as { port: number }
		const boundary = "cm2-task4-abort-boundary"
		return new Promise<void>(resolveAbort => {
			const pending = httpRequest({
				host: "127.0.0.1",
				port: address.port,
				method: "POST",
				path: "/task4-assets/upload",
				headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
			})
			pending.on("error", () => resolveAbort())
			pending.write(
				`--${boundary}\r\nContent-Disposition: form-data; name="role"\r\n\r\nobverse\r\n`
			)
			pending.write(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="abort-secret.png"\r\nContent-Type: application/octet-stream\r\n\r\n`
			)
			pending.write(Buffer.alloc(64 * 1024, 0x61), () => pending.destroy())
		})
	}

	it("shares one in-flight cleanup between abort handling and finalization", async () => {
		const cleanupStarted = deferred()
		const releaseCleanup = deferred()
		const cleanupFinished = deferred()
		const createdDirectories: string[] = []
		let cleanupCalls = 0
		const realRemove = fileSystem.rm
		removeDirectory = async path => {
			createdDirectories.push(path)
			cleanupCalls += 1
			cleanupStarted.resolve()
			await releaseCleanup.promise
			await realRemove(path, { recursive: true, force: true })
			cleanupFinished.resolve()
		}

		try {
			const aborted = abortPartialUpload()
			await cleanupStarted.promise
			releaseCleanup.resolve()
			await Promise.all([aborted, cleanupFinished.promise])

			expect(cleanupCalls).toBe(1)
			expect(createdDirectories.every(path => !existsSync(path))).toBe(true)
		} finally {
			await Promise.all(
				createdDirectories.map(path => realRemove(path, { recursive: true, force: true }))
			)
		}
	})

	it("handles an abort cleanup failure and awaits one successful retry", async () => {
		const retryFinished = deferred()
		const createdDirectories: string[] = []
		let cleanupCalls = 0
		const realRemove = fileSystem.rm
		removeDirectory = async path => {
			createdDirectories.push(path)
			cleanupCalls += 1
			if (cleanupCalls === 1) throw new Error("cleanup failure sentinel")
			await realRemove(path, { recursive: true, force: true })
			retryFinished.resolve()
		}

		try {
			await Promise.all([abortPartialUpload(), retryFinished.promise])

			expect(cleanupCalls).toBe(2)
			expect(createdDirectories.every(path => !existsSync(path))).toBe(true)
		} finally {
			await Promise.all(
				createdDirectories.map(path => realRemove(path, { recursive: true, force: true }))
			)
		}
	})
})
