import { createHash } from "node:crypto"

import { BundleObjectCorruptionError, PostgresBundleObjectStore } from "./bundle-object-store"

describe("PostgresBundleObjectStore", () => {
	const bytes = Buffer.from("immutable resource", "utf8")
	const sha256 = createHash("sha256").update(bytes).digest("hex")

	it("rejects a caller digest mismatch before inserting", async () => {
		const database = { insert: jest.fn() }
		const store = new PostgresBundleObjectStore()

		await expect(
			store.putVerified(database as never, {
				bytes,
				mediaType: "application/json",
				sha256: "0".repeat(64),
			})
		).rejects.toMatchObject({ code: "store_digest_mismatch" })
		expect(database.insert).not.toHaveBeenCalled()
	})

	it("reuses an immutable digest and verifies the read-back bytes and metadata", async () => {
		const onConflictDoNothing = jest.fn().mockResolvedValue(undefined)
		const values = jest.fn().mockReturnValue({ onConflictDoNothing })
		const where = jest
			.fn()
			.mockResolvedValue([
				{ sha256, byteLength: bytes.byteLength, mediaType: "application/json", body: bytes },
			])
		const from = jest.fn().mockReturnValue({ where })
		const database = {
			insert: jest.fn().mockReturnValue({ values }),
			select: jest.fn().mockReturnValue({ from }),
		}
		const store = new PostgresBundleObjectStore()

		await expect(
			store.putVerified(database as never, { bytes, mediaType: "application/json", sha256 })
		).resolves.toEqual({ sha256, byteLength: bytes.byteLength, mediaType: "application/json" })
	})

	it("raises a stable corruption error when stored bytes do not match the digest", async () => {
		const where = jest.fn().mockResolvedValue([
			{
				sha256,
				byteLength: bytes.byteLength,
				mediaType: "application/json",
				body: Buffer.from("tampered resource", "utf8"),
			},
		])
		const database = { select: jest.fn().mockReturnValue({ from: () => ({ where }) }) }
		const store = new PostgresBundleObjectStore()

		await expect(store.readByDigest(database as never, sha256)).rejects.toBeInstanceOf(
			BundleObjectCorruptionError
		)
	})

	it("rejects stored metadata outside the bounded MIME allowlist", async () => {
		const where = jest.fn().mockResolvedValue([
			{
				sha256,
				byteLength: bytes.byteLength,
				mediaType: "text/html",
				body: bytes,
			},
		])
		const database = { select: jest.fn().mockReturnValue({ from: () => ({ where }) }) }
		const store = new PostgresBundleObjectStore()

		await expect(store.readByDigest(database as never, sha256)).rejects.toMatchObject({
			code: "store_corruption",
		})
	})
})
