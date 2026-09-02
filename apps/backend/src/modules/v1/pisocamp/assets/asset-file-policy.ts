import { createHash } from "node:crypto"
import { open } from "node:fs/promises"

import {
	PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES,
	type PisoCampAssetMediaType,
	type PisoCampAssetRole,
} from "@repo/contracts/pisocamp-assets"

const MAX_IMAGE_DIMENSION = 8192
const MAX_TRANSPORT_BYTES = 52_428_800
const SNIFF_BYTES = 65_536

export interface PreparedAssetUpload {
	file: File
	bytes: Buffer
	sha256: string
	mediaType: PisoCampAssetMediaType
	byteLength: number
}

export class AssetFilePolicyError extends Error {
	readonly code: "asset_too_large" | "invalid_asset_file" | "invalid_asset_role"

	constructor(code: AssetFilePolicyError["code"]) {
		super(code)
		this.name = "AssetFilePolicyError"
		this.code = code
	}
}

const rejectFile = (): never => {
	throw new AssetFilePolicyError("invalid_asset_file")
}

const hasPrefix = (bytes: Buffer, prefix: readonly number[]) =>
	bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte)

function crc32(bytes: Buffer) {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
	}
	return (crc ^ 0xffffffff) >>> 0
}

function sniffMediaType(bytes: Buffer): PisoCampAssetMediaType | null {
	if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
	if (hasPrefix(bytes, [0xff, 0xd8])) return "image/jpeg"
	if (
		bytes.length >= 12 &&
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
	) {
		return "image/webp"
	}
	if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "glTF") return "model/gltf-binary"
	if (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) return "model/vnd.usdz+zip"
	if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return "audio/aac"
	if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg"
	const firstNonWhitespace = bytes.findIndex(byte => ![0x09, 0x0a, 0x0d, 0x20].includes(byte))
	if (firstNonWhitespace >= 0 && bytes[firstNonWhitespace] === 0x7b) return "model/gltf+json"
	return null
}

function validateImageDimensions(width: number, height: number) {
	if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
		rejectFile()
	}
}

function validatePng(bytes: Buffer) {
	if (bytes.length < 45 || !hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		rejectFile()
	let offset = 8
	let sawHeader = false
	let sawImageData = false
	let imageDataEnded = false
	let sawEnd = false
	while (offset + 12 <= bytes.length) {
		const length = bytes.readUInt32BE(offset)
		const end = offset + 12 + length
		if (end > bytes.length) rejectFile()
		const type = bytes.toString("ascii", offset + 4, offset + 8)
		const chunkContent = bytes.subarray(offset + 4, offset + 8 + length)
		if (crc32(chunkContent) !== bytes.readUInt32BE(offset + 8 + length)) rejectFile()
		if (!sawHeader) {
			if (type !== "IHDR" || length !== 13) rejectFile()
			validateImageDimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12))
			if (
				bytes[offset + 18] !== 0 ||
				bytes[offset + 19] !== 0 ||
				![0, 1].includes(bytes[offset + 20] ?? -1)
			)
				rejectFile()
			sawHeader = true
		} else if (type === "IHDR") {
			rejectFile()
		}
		if (type === "IDAT") {
			if (imageDataEnded || length < 1) rejectFile()
			sawImageData = true
		} else if (sawImageData && type !== "IEND") {
			imageDataEnded = true
		}
		if (type === "IEND") {
			if (length !== 0 || !sawImageData || end !== bytes.length) rejectFile()
			sawEnd = true
			break
		}
		offset = end
	}
	if (!sawHeader || !sawEnd) rejectFile()
}

function validateJpeg(bytes: Buffer) {
	if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) rejectFile()
	let offset = 2
	let dimensions: { width: number; height: number } | null = null
	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) rejectFile()
		while (bytes[offset] === 0xff) offset += 1
		const marker = bytes[offset++]
		if (marker === 0xd9) {
			if (offset !== bytes.length || dimensions === null) rejectFile()
			const verifiedDimensions = dimensions as { width: number; height: number }
			validateImageDimensions(verifiedDimensions.width, verifiedDimensions.height)
			return
		}
		if (marker === 0xda) {
			const end = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]))
			if (end < offset || end + 2 !== bytes.length || dimensions === null) rejectFile()
			const verifiedDimensions = dimensions as { width: number; height: number }
			validateImageDimensions(verifiedDimensions.width, verifiedDimensions.height)
			return
		}
		if (offset + 2 > bytes.length) rejectFile()
		const segmentLength = bytes.readUInt16BE(offset)
		if (segmentLength < 2 || offset + segmentLength > bytes.length) rejectFile()
		if ([0xc0, 0xc1, 0xc2].includes(marker ?? -1)) {
			if (segmentLength < 7) rejectFile()
			dimensions = {
				height: bytes.readUInt16BE(offset + 3),
				width: bytes.readUInt16BE(offset + 5),
			}
		}
		offset += segmentLength
	}
	rejectFile()
}

function validateWebp(bytes: Buffer) {
	if (
		bytes.length < 30 ||
		bytes.toString("ascii", 0, 4) !== "RIFF" ||
		bytes.readUInt32LE(4) + 8 !== bytes.length ||
		bytes.toString("ascii", 8, 12) !== "WEBP"
	) {
		rejectFile()
	}
	const chunk = bytes.toString("ascii", 12, 16)
	const chunkLength = bytes.readUInt32LE(16)
	if (20 + chunkLength + (chunkLength % 2) !== bytes.length) rejectFile()
	if (chunk === "VP8X" && chunkLength === 10) {
		validateImageDimensions(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1)
		return
	}
	if (
		chunk === "VP8 " &&
		chunkLength >= 10 &&
		bytes[23] === 0x9d &&
		bytes[24] === 0x01 &&
		bytes[25] === 0x2a
	) {
		validateImageDimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff)
		return
	}
	if (chunk === "VP8L" && chunkLength >= 5 && bytes[20] === 0x2f) {
		const packed = bytes.readUInt32LE(21)
		validateImageDimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1)
		return
	}
	rejectFile()
}

function validateMp3(bytes: Buffer) {
	let offset = 0
	let frames = 0
	while (offset + 4 <= bytes.length) {
		const header = bytes.readUInt32BE(offset)
		if ((header & 0xffe00000) >>> 0 !== 0xffe00000) rejectFile()
		const versionBits = (header >>> 19) & 0x3
		const layerBits = (header >>> 17) & 0x3
		const bitrateIndex = (header >>> 12) & 0xf
		const sampleIndex = (header >>> 10) & 0x3
		const padding = (header >>> 9) & 0x1
		if (
			versionBits !== 3 ||
			layerBits !== 1 ||
			bitrateIndex < 1 ||
			bitrateIndex > 14 ||
			sampleIndex > 2
		) {
			rejectFile()
		}
		const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
		const sampleRates = [44_100, 48_000, 32_000]
		const length =
			Math.floor((144_000 * bitrates[bitrateIndex]!) / sampleRates[sampleIndex]!) + padding
		if (length < 4 || offset + length > bytes.length) rejectFile()
		offset += length
		frames += 1
	}
	if (frames < 1 || offset !== bytes.length) rejectFile()
}

function validateAac(bytes: Buffer) {
	let offset = 0
	let frames = 0
	while (offset + 7 <= bytes.length) {
		if (bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xf6) !== 0xf0) rejectFile()
		const protectionAbsent = bytes[offset + 1]! & 1
		const headerLength = protectionAbsent ? 7 : 9
		const frameLength =
			((bytes[offset + 3]! & 0x03) << 11) | (bytes[offset + 4]! << 3) | (bytes[offset + 5]! >>> 5)
		if (frameLength < headerLength || offset + frameLength > bytes.length) rejectFile()
		offset += frameLength
		frames += 1
	}
	if (frames < 1 || offset !== bytes.length) rejectFile()
}

function decodeEmbeddedBuffer(uri: string): Buffer {
	const match = /^data:[^,;]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(uri)
	const encoded = match?.[1] ?? rejectFile()
	if (encoded.length % 4 !== 0) rejectFile()
	const decoded = Buffer.from(encoded, "base64")
	if (decoded.toString("base64") !== encoded) rejectFile()
	return decoded
}

function nonNegativeInteger(value: unknown, fallback?: number): number {
	if (value === undefined && fallback !== undefined) return fallback
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) rejectFile()
	return value as number
}

function validateGltfDocument(value: unknown, container: "gltf" | "glb") {
	if (!value || typeof value !== "object" || Array.isArray(value)) rejectFile()
	const document = value as Record<string, unknown>
	const asset = document.asset
	if (!asset || typeof asset !== "object" || Array.isArray(asset)) rejectFile()
	const version = (asset as Record<string, unknown>).version
	if (typeof version !== "string" || !/^2(?:\.\d+)?$/.test(version)) rejectFile()

	const bufferLengths: number[] = []
	let binaryBufferLength: number | null = null
	const buffers = document.buffers
	if (buffers !== undefined) {
		if (!Array.isArray(buffers)) rejectFile()
		for (const [index, member] of (buffers as unknown[]).entries()) {
			if (!member || typeof member !== "object" || Array.isArray(member)) rejectFile()
			const buffer = member as Record<string, unknown>
			const byteLength = nonNegativeInteger(buffer.byteLength)
			if (byteLength < 1) rejectFile()
			bufferLengths.push(byteLength)
			if (buffer.uri === undefined) {
				if (container !== "glb" || index !== 0 || binaryBufferLength !== null) rejectFile()
				binaryBufferLength = byteLength
			} else {
				if (
					typeof buffer.uri !== "string" ||
					decodeEmbeddedBuffer(buffer.uri).length !== byteLength
				)
					rejectFile()
			}
		}
	}

	const bufferViews = document.bufferViews
	const bufferViewCount = Array.isArray(bufferViews) ? bufferViews.length : 0
	if (bufferViews !== undefined && !Array.isArray(bufferViews)) rejectFile()
	for (const member of (bufferViews ?? []) as unknown[]) {
		if (!member || typeof member !== "object" || Array.isArray(member)) rejectFile()
		const view = member as Record<string, unknown>
		const bufferIndex = nonNegativeInteger(view.buffer)
		const byteOffset = nonNegativeInteger(view.byteOffset, 0)
		const byteLength = nonNegativeInteger(view.byteLength)
		if (
			byteLength < 1 ||
			bufferIndex >= bufferLengths.length ||
			byteOffset + byteLength > bufferLengths[bufferIndex]!
		)
			rejectFile()
	}

	const images = document.images
	if (images !== undefined) {
		if (!Array.isArray(images)) rejectFile()
		for (const member of images as unknown[]) {
			if (!member || typeof member !== "object" || Array.isArray(member)) rejectFile()
			const image = member as Record<string, unknown>
			const hasUri = image.uri !== undefined
			const hasBufferView = image.bufferView !== undefined
			if (hasUri === hasBufferView) rejectFile()
			if (hasUri) {
				if (typeof image.uri !== "string") rejectFile()
				decodeEmbeddedBuffer(image.uri as string)
			} else {
				const index = nonNegativeInteger(image.bufferView)
				if (
					index >= bufferViewCount ||
					typeof image.mimeType !== "string" ||
					!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)
				)
					rejectFile()
			}
		}
	}
	return { binaryBufferLength }
}

function parseJson(bytes: Buffer) {
	try {
		return JSON.parse(bytes.toString("utf8")) as unknown
	} catch {
		return rejectFile()
	}
}

function validateGlb(bytes: Buffer) {
	if (
		bytes.length < 20 ||
		bytes.toString("ascii", 0, 4) !== "glTF" ||
		bytes.readUInt32LE(4) !== 2
	) {
		rejectFile()
	}
	if (bytes.readUInt32LE(8) !== bytes.length) rejectFile()
	let offset = 12
	let json: Buffer | null = null
	let binary: Buffer | null = null
	while (offset + 8 <= bytes.length) {
		const length = bytes.readUInt32LE(offset)
		const type = bytes.readUInt32LE(offset + 4)
		const end = offset + 8 + length
		if (end > bytes.length || length % 4 !== 0) rejectFile()
		if (offset === 12) {
			if (type !== 0x4e4f534a) rejectFile()
			json = bytes.subarray(offset + 8, end)
		} else {
			if (type !== 0x004e4942 || binary !== null) rejectFile()
			binary = bytes.subarray(offset + 8, end)
		}
		offset = end
	}
	if (!json || offset !== bytes.length) rejectFile()
	const jsonChunk = json as Buffer
	for (let index = jsonChunk.length - 1; index >= 0; index -= 1) {
		const byte = jsonChunk[index]
		if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break
		if (byte !== 0x20) rejectFile()
	}
	const { binaryBufferLength } = validateGltfDocument(parseJson(jsonChunk), "glb")
	if (binaryBufferLength === null) {
		if (binary !== null) rejectFile()
	} else {
		const binaryChunk = binary ?? rejectFile()
		if (binaryChunk.length < binaryBufferLength || binaryChunk.length - binaryBufferLength > 3)
			rejectFile()
		for (const byte of binaryChunk.subarray(binaryBufferLength)) {
			if (byte !== 0) rejectFile()
		}
	}
}

const unsafeArchiveName = (name: string) =>
	!name ||
	name.includes("\\") ||
	/[\u0000-\u001f\u007f]/.test(name) ||
	name.startsWith("/") ||
	/^[A-Za-z]:/.test(name) ||
	name.split("/").some(part => part === ".." || part === "." || part === "")

function validateUsdz(bytes: Buffer) {
	if (bytes.length < 98 || bytes.readUInt32LE(0) !== 0x04034b50) rejectFile()
	const endOffset = bytes.length - 22
	if (
		bytes.readUInt32LE(endOffset) !== 0x06054b50 ||
		bytes.readUInt16LE(endOffset + 4) !== 0 ||
		bytes.readUInt16LE(endOffset + 6) !== 0 ||
		bytes.readUInt16LE(endOffset + 8) !== bytes.readUInt16LE(endOffset + 10) ||
		bytes.readUInt16LE(endOffset + 20) !== 0
	)
		rejectFile()
	const entryCount = bytes.readUInt16LE(endOffset + 10)
	const centralSize = bytes.readUInt32LE(endOffset + 12)
	const centralOffset = bytes.readUInt32LE(endOffset + 16)
	if (entryCount < 1 || centralOffset + centralSize !== endOffset) rejectFile()
	let offset = centralOffset
	const storedEntries: Array<{
		name: string
		localOffset: number
		dataStart: number
		dataEnd: number
		body: Buffer
	}> = []
	for (let entry = 0; entry < entryCount; entry += 1) {
		if (offset + 46 > endOffset || bytes.readUInt32LE(offset) !== 0x02014b50) rejectFile()
		const flags = bytes.readUInt16LE(offset + 8)
		const method = bytes.readUInt16LE(offset + 10)
		const checksum = bytes.readUInt32LE(offset + 16)
		const compressedLength = bytes.readUInt32LE(offset + 20)
		const uncompressedLength = bytes.readUInt32LE(offset + 24)
		const nameLength = bytes.readUInt16LE(offset + 28)
		const extraLength = bytes.readUInt16LE(offset + 30)
		const commentLength = bytes.readUInt16LE(offset + 32)
		const localOffset = bytes.readUInt32LE(offset + 42)
		const next = offset + 46 + nameLength + extraLength + commentLength
		if (
			next > endOffset ||
			flags !== 0 ||
			method !== 0 ||
			compressedLength !== uncompressedLength ||
			localOffset + 30 > centralOffset
		)
			rejectFile()
		const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength)
		if (unsafeArchiveName(name)) rejectFile()
		if (bytes.readUInt32LE(localOffset) !== 0x04034b50) rejectFile()
		const localFlags = bytes.readUInt16LE(localOffset + 6)
		const localMethod = bytes.readUInt16LE(localOffset + 8)
		const localChecksum = bytes.readUInt32LE(localOffset + 14)
		const localCompressedLength = bytes.readUInt32LE(localOffset + 18)
		const localUncompressedLength = bytes.readUInt32LE(localOffset + 22)
		const localNameLength = bytes.readUInt16LE(localOffset + 26)
		const localExtraLength = bytes.readUInt16LE(localOffset + 28)
		const dataStart = localOffset + 30 + localNameLength + localExtraLength
		if (dataStart > centralOffset) rejectFile()
		const localName = bytes.toString("utf8", localOffset + 30, localOffset + 30 + localNameLength)
		const dataEnd = dataStart + compressedLength
		const body = bytes.subarray(dataStart, dataEnd)
		if (
			localFlags !== flags ||
			localMethod !== method ||
			localChecksum !== checksum ||
			localCompressedLength !== compressedLength ||
			localUncompressedLength !== uncompressedLength ||
			localName !== name ||
			dataStart % 64 !== 0 ||
			dataEnd > centralOffset ||
			crc32(body) !== checksum
		)
			rejectFile()
		storedEntries.push({ name, localOffset, dataStart, dataEnd, body })
		offset = next
	}
	if (offset !== endOffset) rejectFile()
	storedEntries.sort((left, right) => left.localOffset - right.localOffset)
	if (storedEntries[0]?.localOffset !== 0) rejectFile()
	for (let index = 1; index < storedEntries.length; index += 1) {
		if (storedEntries[index]!.localOffset < storedEntries[index - 1]!.dataEnd) rejectFile()
	}
	if (new Set(storedEntries.map(entry => entry.name)).size !== storedEntries.length) rejectFile()
	const root = storedEntries[0]!
	const extension = /\.([^.]+)$/i.exec(root.name)?.[1]?.toLowerCase()
	const asciiStart = root.body.toString("ascii", 0, Math.min(root.body.length, 16))
	const validUsdPayload =
		(extension === "usda" && asciiStart.startsWith("#usda ")) ||
		(extension === "usdc" && asciiStart.startsWith("PXR-USDC")) ||
		(extension === "usd" && (asciiStart.startsWith("#usda ") || asciiStart.startsWith("PXR-USDC")))
	if (!validUsdPayload) rejectFile()
}

function validateStructure(bytes: Buffer, mediaType: PisoCampAssetMediaType) {
	switch (mediaType) {
		case "image/png":
			return validatePng(bytes)
		case "image/jpeg":
			return validateJpeg(bytes)
		case "image/webp":
			return validateWebp(bytes)
		case "audio/mpeg":
			return validateMp3(bytes)
		case "audio/aac":
			return validateAac(bytes)
		case "model/gltf-binary":
			return validateGlb(bytes)
		case "model/gltf+json":
			return validateGltfDocument(parseJson(bytes), "gltf")
		case "model/vnd.usdz+zip":
			return validateUsdz(bytes)
	}
}

function validateRole(mediaType: PisoCampAssetMediaType, role: PisoCampAssetRole) {
	const compatible = mediaType.startsWith("image/")
		? ["obverse", "reverse", "edge", "texture"].includes(role)
		: mediaType.startsWith("audio/")
			? role === "audio"
			: role === "animation"
	if (!compatible) throw new AssetFilePolicyError("invalid_asset_role")
}

export async function prepareAssetUpload(
	path: string,
	role: PisoCampAssetRole
): Promise<PreparedAssetUpload> {
	const handle = await open(path, "r")
	try {
		const stats = await handle.stat()
		if (!stats.isFile() || stats.size < 1) rejectFile()
		if (stats.size > MAX_TRANSPORT_BYTES) throw new AssetFilePolicyError("asset_too_large")
		const prefix = Buffer.alloc(Math.min(stats.size, SNIFF_BYTES))
		await handle.read(prefix, 0, prefix.length, 0)
		const detectedMediaType = sniffMediaType(prefix)
		if (!detectedMediaType) rejectFile()
		const mediaType = detectedMediaType as PisoCampAssetMediaType
		if (stats.size > PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES[mediaType]) {
			throw new AssetFilePolicyError("asset_too_large")
		}
		const bytes = await handle.readFile()
		if (bytes.length !== stats.size) rejectFile()
		validateStructure(bytes, mediaType)
		validateRole(mediaType, role)
		const sha256 = createHash("sha256").update(bytes).digest("hex")
		return {
			file: new File([bytes], "asset", { type: mediaType }),
			bytes,
			sha256,
			mediaType,
			byteLength: bytes.length,
		}
	} finally {
		await handle.close()
	}
}
