import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { buildNeutralCoinModel } from "./pisocamp-coin-model.js"

interface Gltf {
	asset: { version: string; generator: string }
	meshes: { primitives: { attributes: Record<string, number>; indices: number; mode: number }[] }[]
	accessors: { componentType: number; count: number; type: string; normalized?: boolean }[]
	bufferViews: { buffer: number; byteOffset: number; byteLength: number }[]
	buffers: { byteLength: number }[]
	materials: unknown[]
}

function readGlb(bytes: Buffer): { document: Gltf; binary: Buffer } {
	const jsonLength = bytes.readUInt32LE(12)
	const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf
	const binaryLength = bytes.readUInt32LE(20 + jsonLength)
	const binaryStart = 28 + jsonLength
	return { document, binary: bytes.subarray(binaryStart, binaryStart + binaryLength) }
}

describe("CE-2 neutral coin model", () => {
	it("is a well-formed binary glTF 2.0 document", () => {
		const bytes = buildNeutralCoinModel()

		expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF")
		expect(bytes.readUInt32LE(4)).toBe(2)
		expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength)
		expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a)

		const { document, binary } = readGlb(bytes)
		expect(document.asset.version).toBe("2.0")
		expect(document.meshes).toHaveLength(1)
		expect(document.meshes[0]?.primitives).toHaveLength(1)
		expect(document.meshes[0]?.primitives[0]?.mode).toBe(4)
		expect(binary.byteLength).toBe(document.buffers[0]?.byteLength)
	})

	it("declares positions, normals and vertex colours over one buffer", () => {
		const { document, binary } = readGlb(buildNeutralCoinModel())
		const attributes = document.meshes[0]!.primitives[0]!.attributes

		expect(Object.keys(attributes).sort()).toEqual(["COLOR_0", "NORMAL", "POSITION"])
		const position = document.accessors[attributes.POSITION!]!
		const normal = document.accessors[attributes.NORMAL!]!
		const color = document.accessors[attributes.COLOR_0!]!
		const indices = document.accessors[document.meshes[0]!.primitives[0]!.indices]!

		expect(position).toMatchObject({ componentType: 5126, type: "VEC3" })
		expect(normal).toMatchObject({ componentType: 5126, type: "VEC3" })
		expect(color).toMatchObject({ componentType: 5121, type: "VEC4", normalized: true })
		expect(indices).toMatchObject({ componentType: 5123, type: "SCALAR" })
		expect(normal.count).toBe(position.count)
		expect(color.count).toBe(position.count)
		// Unsigned-short indices only address 65,536 vertices.
		expect(position.count).toBeLessThanOrEqual(65535)
		expect(indices.count % 3).toBe(0)

		for (const view of document.bufferViews) {
			expect(view.buffer).toBe(0)
			expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(binary.byteLength)
		}
	})

	it("is shaped like a coin: round, flat and centred on the origin", () => {
		const { document, binary } = readGlb(buildNeutralCoinModel())
		const attributes = document.meshes[0]!.primitives[0]!.attributes
		const accessor = document.accessors[attributes.POSITION!]!
		const view = document.bufferViews[0]!
		const positions = new Float32Array(
			binary.buffer.slice(
				binary.byteOffset + view.byteOffset,
				binary.byteOffset + view.byteOffset + accessor.count * 12
			)
		)

		let maximumRadius = 0
		let maximumDepth = 0
		for (let vertex = 0; vertex < accessor.count; vertex += 1) {
			const x = positions[vertex * 3]!
			const y = positions[vertex * 3 + 1]!
			const z = positions[vertex * 3 + 2]!
			maximumRadius = Math.max(maximumRadius, Math.hypot(x, y))
			maximumDepth = Math.max(maximumDepth, Math.abs(z))
		}

		expect(maximumRadius).toBeCloseTo(1, 5)
		expect(maximumDepth).toBeCloseTo(0.08, 5)
		expect(maximumRadius / maximumDepth).toBeGreaterThan(5)
	})

	it("gives the two faces different colours and a reeded edge", () => {
		const { document, binary } = readGlb(buildNeutralCoinModel())
		const attributes = document.meshes[0]!.primitives[0]!.attributes
		const count = document.accessors[attributes.POSITION!]!.count
		const normalView = document.bufferViews[1]!
		const colorView = document.bufferViews[2]!
		const normals = new Float32Array(
			binary.buffer.slice(
				binary.byteOffset + normalView.byteOffset,
				binary.byteOffset + normalView.byteOffset + count * 12
			)
		)
		const colors = binary.subarray(colorView.byteOffset, colorView.byteOffset + count * 4)

		let warmFront = 0
		let coolBack = 0
		let edge = 0
		for (let vertex = 0; vertex < count; vertex += 1) {
			const normalZ = normals[vertex * 3 + 2]!
			const red = colors[vertex * 4]!
			const blue = colors[vertex * 4 + 2]!
			if (normalZ > 0.9) {
				expect(red).toBeGreaterThan(blue)
				warmFront += 1
			} else if (normalZ < -0.9) {
				expect(blue).toBeGreaterThan(red)
				coolBack += 1
			} else {
				edge += 1
			}
		}

		expect(warmFront).toBeGreaterThan(0)
		expect(coolBack).toBeGreaterThan(0)
		expect(edge).toBeGreaterThan(0)
	})


	it("winds every triangle to face outwards", () => {
		const { document, binary } = readGlb(buildNeutralCoinModel())
		const primitive = document.meshes[0]!.primitives[0]!
		const count = document.accessors[primitive.attributes.POSITION!]!.count
		const indexCount = document.accessors[primitive.indices]!.count
		const read = (index: number, length: number) => {
			const view = document.bufferViews[index]!
			return binary.buffer.slice(
				binary.byteOffset + view.byteOffset,
				binary.byteOffset + view.byteOffset + length
			)
		}
		const positions = new Float32Array(read(0, count * 12))
		const normals = new Float32Array(read(1, count * 12))
		const indices = new Uint16Array(read(3, indexCount * 2))

		// A triangle wound the wrong way round is culled as a back face, which
		// is how the coin's own front once vanished behind its back.
		for (let triangle = 0; triangle < indexCount / 3; triangle += 1) {
			const [a, b, c] = [
				indices[triangle * 3]!,
				indices[triangle * 3 + 1]!,
				indices[triangle * 3 + 2]!,
			]
			const edge1 = [0, 1, 2].map(axis => positions[b * 3 + axis]! - positions[a * 3 + axis]!)
			const edge2 = [0, 1, 2].map(axis => positions[c * 3 + axis]! - positions[a * 3 + axis]!)
			const geometric = [
				edge1[1]! * edge2[2]! - edge1[2]! * edge2[1]!,
				edge1[2]! * edge2[0]! - edge1[0]! * edge2[2]!,
				edge1[0]! * edge2[1]! - edge1[1]! * edge2[0]!,
			]
			const agreement = geometric.reduce(
				(total, value, axis) => total + value * normals[a * 3 + axis]!,
				0
			)
			expect(agreement, `triangle ${triangle}`).toBeGreaterThan(0)
		}
	})

	it("produces the same bytes every time it is generated", () => {
		const first = buildNeutralCoinModel()
		const second = buildNeutralCoinModel()

		expect(first.equals(second)).toBe(true)
		// The checked-in seed is validated by regeneration, so the digest is
		// part of the contract, not an incidental detail.
		expect(createHash("sha256").update(first).digest("hex")).toBe(
			"5e080a9ba664afcd262dba004ba149b780541ed46969cf5c3ff4d89d9876525d"
		)
	})

	it("stays well inside the bundle's core-entry size limit", () => {
		expect(buildNeutralCoinModel().byteLength).toBeLessThan(5_242_880)
	})
})
