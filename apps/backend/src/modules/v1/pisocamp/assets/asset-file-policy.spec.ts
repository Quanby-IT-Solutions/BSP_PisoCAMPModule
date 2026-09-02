import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deflateSync } from "node:zlib"

import type { PisoCampAssetRole } from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/asset.schema"
import { prepareAssetUpload, type AssetFilePolicyError } from "./asset-file-policy"

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

const png = (width = 1, height = 1) => {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	const scanlines = Buffer.alloc(height * (1 + width * 4))
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(scanlines)),
		pngChunk("IEND"),
	])
}

const pngWithoutIdat = () => {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(1, 0)
	ihdr.writeUInt32BE(1, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IEND"),
	])
}

const pngWithNonContiguousIdat = () => {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(1, 0)
	ihdr.writeUInt32BE(1, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	const compressed = deflateSync(Buffer.alloc(5))
	const split = Math.floor(compressed.length / 2)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", compressed.subarray(0, split)),
		pngChunk("tEXt", Buffer.from("kind\0fixture")),
		pngChunk("IDAT", compressed.subarray(split)),
		pngChunk("IEND"),
	])
}

const jpeg = (width = 1, height = 1) =>
	Buffer.from([
		0xff,
		0xd8,
		0xff,
		0xc0,
		0x00,
		0x0b,
		0x08,
		(height >>> 8) & 0xff,
		height & 0xff,
		(width >>> 8) & 0xff,
		width & 0xff,
		0x01,
		0x01,
		0x11,
		0x00,
		0xff,
		0xd9,
	])

const webp = (width = 1, height = 1) => {
	const bytes = Buffer.alloc(30)
	bytes.write("RIFF", 0, "ascii")
	bytes.writeUInt32LE(22, 4)
	bytes.write("WEBPVP8X", 8, "ascii")
	bytes.writeUInt32LE(10, 16)
	bytes.writeUIntLE(width - 1, 24, 3)
	bytes.writeUIntLE(height - 1, 27, 3)
	return bytes
}

const mp3 = () => {
	const bytes = Buffer.alloc(417)
	bytes.set([0xff, 0xfb, 0x90, 0x00])
	return bytes
}

const aac = () => Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x3f, 0xfc, 0x00, 0x00])

const gltf = (uri = "data:application/octet-stream;base64,AA==") =>
	Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 1, uri }] }))

const gltfWithBufferViewImage = () =>
	Buffer.from(
		JSON.stringify({
			asset: { version: "2.0" },
			buffers: [{ byteLength: 1, uri: "data:application/octet-stream;base64,AA==" }],
			bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 1 }],
			images: [{ bufferView: 0, mimeType: "image/png" }],
		})
	)

const glb = (declaredBufferLength = 1, binary = Buffer.from([0])) => {
	const document = {
		asset: { version: "2.0" },
		buffers: [{ byteLength: declaredBufferLength }],
		bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: declaredBufferLength }],
	}
	const jsonText = JSON.stringify(document)
	const json = Buffer.from(jsonText.padEnd(Math.ceil(jsonText.length / 4) * 4, " "))
	const binaryChunk = Buffer.alloc(Math.ceil(binary.length / 4) * 4)
	binary.copy(binaryChunk)
	const bytes = Buffer.alloc(28 + json.length + binaryChunk.length)
	bytes.write("glTF", 0, "ascii")
	bytes.writeUInt32LE(2, 4)
	bytes.writeUInt32LE(bytes.length, 8)
	bytes.writeUInt32LE(json.length, 12)
	bytes.writeUInt32LE(0x4e4f534a, 16)
	json.copy(bytes, 20)
	const binaryOffset = 20 + json.length
	bytes.writeUInt32LE(binaryChunk.length, binaryOffset)
	bytes.writeUInt32LE(0x004e4942, binaryOffset + 4)
	binaryChunk.copy(bytes, binaryOffset + 8)
	return bytes
}

const usdz = (
	entryName = "scene.usda",
	method = 0,
	alignPayload = true,
	body = Buffer.from("#usda 1.0\n")
) => {
	const name = Buffer.from(entryName)
	const extraLength = alignPayload ? (64 - ((30 + name.length) % 64)) % 64 : 0
	const extra = Buffer.alloc(extraLength)
	if (extraLength >= 4) {
		extra.writeUInt16LE(0x1986, 0)
		extra.writeUInt16LE(extraLength - 4, 2)
	}
	const checksum = crc32(body)
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt16LE(20, 4)
	local.writeUInt16LE(method, 8)
	local.writeUInt32LE(checksum, 14)
	local.writeUInt32LE(body.length, 18)
	local.writeUInt32LE(body.length, 22)
	local.writeUInt16LE(name.length, 26)
	local.writeUInt16LE(extra.length, 28)
	const central = Buffer.alloc(46)
	central.writeUInt32LE(0x02014b50, 0)
	central.writeUInt16LE(20, 4)
	central.writeUInt16LE(20, 6)
	central.writeUInt16LE(method, 10)
	central.writeUInt32LE(checksum, 16)
	central.writeUInt32LE(body.length, 20)
	central.writeUInt32LE(body.length, 24)
	central.writeUInt16LE(name.length, 28)
	const centralOffset = local.length + name.length + extra.length + body.length
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(1, 8)
	end.writeUInt16LE(1, 10)
	end.writeUInt32LE(central.length + name.length, 12)
	end.writeUInt32LE(centralOffset, 16)
	return Buffer.concat([local, name, extra, body, central, name, end])
}

const usdzWithMismatchedLocalLength = () => {
	const bytes = usdz()
	bytes.writeUInt32LE(bytes.readUInt32LE(18) + 1, 18)
	return bytes
}

const withCorruptedPngCrc = () => {
	const bytes = png()
	bytes.writeUInt32BE((bytes.readUInt32BE(29) ^ 1) >>> 0, 29)
	return bytes
}

const withPngIdatAfterIend = () => {
	const bytes = png()
	const end = pngChunk("IEND")
	return Buffer.concat([
		bytes.subarray(0, bytes.length - end.length),
		end,
		pngChunk("IDAT", Buffer.from([0])),
	])
}

const withCorruptedUsdzCrc = () => {
	const bytes = usdz()
	bytes.writeUInt32LE((bytes.readUInt32LE(14) ^ 1) >>> 0, 14)
	return bytes
}

const usdzWithOverlappingEntries = () => {
	const bytes = usdz()
	const endOffset = bytes.length - 22
	const centralOffset = bytes.readUInt32LE(endOffset + 16)
	const central = bytes.subarray(centralOffset, endOffset)
	const end = Buffer.from(bytes.subarray(endOffset))
	end.writeUInt16LE(2, 8)
	end.writeUInt16LE(2, 10)
	end.writeUInt32LE(central.length * 2, 12)
	return Buffer.concat([bytes.subarray(0, centralOffset), central, central, end])
}

const glbWithSecondBinChunk = () => {
	const bytes = glb()
	const duplicate = Buffer.alloc(12)
	duplicate.writeUInt32LE(4, 0)
	duplicate.writeUInt32LE(0x004e4942, 4)
	const result = Buffer.concat([bytes, duplicate])
	result.writeUInt32LE(result.length, 8)
	return result
}

const glbWithJsonPaddingByte = (paddingByte: number) => {
	const bytes = glb()
	const jsonLength = bytes.readUInt32LE(12)
	bytes[20 + jsonLength - 1] = paddingByte
	return bytes
}

const glbWithBinPaddingByte = (paddingIndex: 1 | 2 | 3) => {
	const bytes = glb()
	const jsonLength = bytes.readUInt32LE(12)
	const binaryStart = 20 + jsonLength + 8
	bytes[binaryStart + paddingIndex] = 0x7f
	return bytes
}

describe("prepareAssetUpload", () => {
	let directory: string
	let sequence = 0

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "cm2-policy-test-"))
	})

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true })
	})

	const prepare = async (bytes: Buffer, role: PisoCampAssetRole, suffix = ".untrusted") => {
		const path = join(directory, `${sequence++}${suffix}`)
		await writeFile(path, bytes)
		return prepareAssetUpload(path, role)
	}

	it.each([
		["PNG", png(), "obverse", "image/png"],
		["JPEG", jpeg(), "reverse", "image/jpeg"],
		["WebP", webp(), "texture", "image/webp"],
		["MP3", mp3(), "audio", "audio/mpeg"],
		["AAC", aac(), "audio", "audio/aac"],
		["GLB", glb(), "animation", "model/gltf-binary"],
		["GLTF", gltf(), "animation", "model/gltf+json"],
		["GLTF bufferView resource", gltfWithBufferViewImage(), "animation", "model/gltf+json"],
		["USDZ", usdz(), "animation", "model/vnd.usdz+zip"],
	] as const)(
		"recognizes a structurally valid %s independently of its filename",
		async (_, bytes, role, mediaType) => {
			const prepared = await prepare(bytes, role, ".spoofed.exe")

			expect(prepared).toMatchObject({
				bytes,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				mediaType,
				byteLength: bytes.length,
			})
			expect(prepared.file).toBeInstanceOf(File)
			expect(prepared.file.type).toBe(mediaType)
			expect(prepared.file.size).toBe(bytes.length)
			expect(prepared.file.name).toBe("asset")
		}
	)

	it.each([
		["empty input", Buffer.alloc(0), "obverse"],
		["truncated PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "obverse"],
		["PNG with a corrupted chunk CRC", withCorruptedPngCrc(), "obverse"],
		["PNG missing IDAT", pngWithoutIdat(), "obverse"],
		["PNG with non-contiguous IDAT", pngWithNonContiguousIdat(), "obverse"],
		["PNG with IDAT after IEND", withPngIdatAfterIend(), "obverse"],
		["malformed JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "obverse"],
		["truncated WebP", Buffer.from("RIFF\0\0\0\0WEBP"), "obverse"],
		["malformed MP3 framing", Buffer.from([0xff, 0xfb, 0x90, 0x00]), "audio"],
		["truncated AAC framing", Buffer.from([0xff, 0xf1, 0x50]), "audio"],
		["generic ZIP", usdz("payload.txt"), "animation"],
		["USDZ traversal", usdz("../scene.usda"), "animation"],
		["compressed USDZ", usdz("scene.usda", 8), "animation"],
		["unaligned USDZ payload", usdz("scene.usda", 0, false), "animation"],
		["USDZ with a corrupted stored-entry CRC", withCorruptedUsdzCrc(), "animation"],
		[
			"USDZ with a non-USD root payload",
			usdz("scene.usda", 0, true, Buffer.from("not usd")),
			"animation",
		],
		["USDZ with overlapping entries", usdzWithOverlappingEntries(), "animation"],
		["USDZ local-header length mismatch", usdzWithMismatchedLocalLength(), "animation"],
		["polyglot PNG/ZIP", Buffer.concat([png(), usdz()]), "obverse"],
	] as const)("rejects %s with a stable non-reflective policy error", async (_, bytes, role) => {
		await expect(prepare(bytes, role)).rejects.toEqual(
			expect.objectContaining<Partial<AssetFilePolicyError>>({ code: "invalid_asset_file" })
		)
	})

	it.each([
		["PNG", png(8193, 1)],
		["JPEG", jpeg(1, 8193)],
		["WebP", webp(8193, 1)],
	] as const)("rejects %s dimensions above 8192 pixels", async (_, bytes) => {
		await expect(prepare(bytes, "obverse")).rejects.toMatchObject({ code: "invalid_asset_file" })
	})

	it("rejects a GLB whose declared length differs from its actual length", async () => {
		const bytes = glb()
		bytes.writeUInt32LE(bytes.length + 4, 8)
		await expect(prepare(bytes, "animation")).rejects.toMatchObject({ code: "invalid_asset_file" })
	})

	it("rejects a GLB whose BIN bytes do not satisfy its URI-less buffer", async () => {
		await expect(prepare(glb(5, Buffer.from([0])), "animation")).rejects.toMatchObject({
			code: "invalid_asset_file",
		})
	})

	it("rejects a GLB with multiple BIN chunks", async () => {
		await expect(prepare(glbWithSecondBinChunk(), "animation")).rejects.toMatchObject({
			code: "invalid_asset_file",
		})
	})

	it.each([
		["tab", 0x09],
		["line feed", 0x0a],
		["carriage return", 0x0d],
	] as const)("rejects a GLB whose JSON padding contains %s", async (_, paddingByte) => {
		await expect(prepare(glbWithJsonPaddingByte(paddingByte), "animation")).rejects.toMatchObject({
			code: "invalid_asset_file",
		})
	})

	it.each([1, 2, 3] as const)(
		"rejects a GLB whose BIN padding byte %s is non-zero",
		async paddingIndex => {
			await expect(prepare(glbWithBinPaddingByte(paddingIndex), "animation")).rejects.toMatchObject(
				{
					code: "invalid_asset_file",
				}
			)
		}
	)

	it.each([
		Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 1 }] })),
		Buffer.from(JSON.stringify({ asset: { version: "2.0" }, images: [{}] })),
	])("rejects a standalone GLTF with an unresolved embedded resource", async bytes => {
		await expect(prepare(bytes, "animation")).rejects.toMatchObject({ code: "invalid_asset_file" })
	})

	it.each([
		"https://example.invalid/body.bin",
		"/private/body.bin",
		"C:\\private\\body.bin",
		"../body.bin",
		"body.bin",
	] as const)("rejects a GLTF with non-embedded URI %s", async uri => {
		await expect(prepare(gltf(uri), "animation")).rejects.toMatchObject({
			code: "invalid_asset_file",
		})
	})

	it.each([
		["image/png", png(), "audio"],
		["audio/mpeg", mp3(), "texture"],
		["model/gltf-binary", glb(), "edge"],
	] as const)("rejects %s in an incompatible role", async (_, bytes, role) => {
		await expect(prepare(bytes, role as PisoCampAssetRole)).rejects.toMatchObject({
			code: "invalid_asset_role",
		})
	})

	it("rejects an image category cap plus one before structural parsing", async () => {
		const bytes = Buffer.alloc(10_485_761)
		png().copy(bytes)
		await expect(prepare(bytes, "obverse")).rejects.toMatchObject({ code: "asset_too_large" })
	})
})
