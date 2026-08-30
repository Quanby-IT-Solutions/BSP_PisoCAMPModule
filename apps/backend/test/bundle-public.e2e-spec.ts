import { HttpStatus, type INestApplication } from "@nestjs/common"
import { createHash, createPrivateKey, sign } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals"
import { eq, sql } from "drizzle-orm"
import request from "supertest"
import { type App } from "supertest/types"

import {
	contentBundleBlobs,
	contentBundleChannels,
	contentBundleManifestEntries,
	contentBundles,
} from "@repo/db/schema"

import { createApplication } from "../src/bootstrap"
import { db } from "../src/common/database/database.client"
import { BundleRepository } from "../src/modules/v1/pisocamp/bundle/bundle-repository"
import { assertDisposablePostgres } from "../src/test-support/destructive-database.guard"

const fixture = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL(
				"../../../packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json",
				import.meta.url
			)
		),
		"utf8"
	)
) as { keyId: string; privateKeyPkcs8Pem: string }

const RESOURCE_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x43, 0x45, 0x31, 0x2d, 0x52, 0x41, 0x4e, 0x47,
	0x45,
])
const RESOURCE_SHA256 = createHash("sha256").update(RESOURCE_BYTES).digest("hex")
const RAW_ERROR_SENTINEL = "raw-db-password-and-storage-key-sentinel"
const COOKIE_SENTINEL = "private-session-cookie-sentinel"

describe("composed anonymous Piso CAMP bundle HTTP routes", () => {
	let app: INestApplication<App>
	let envelope: {
		schemaVersion: 1
		algorithm: "Ed25519"
		keyId: string
		payload: string
		signature: string
	}

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_channel, content_bundle_manifest_entry,
			content_bundle_rebuild_request, content_bundle_blob, content_bundle
			restart identity cascade
		`)
		app = (await createApplication()) as INestApplication<App>
		await app.init()
	})

	afterAll(async () => {
		await app?.close()
	})

	it("returns a safe anonymous 503 while no ready primary bundle exists", async () => {
		const response = await request(app.getHttpServer())
			.get("/api/v1/pisocamp/bundle/manifest")
			.set("Cookie", `better-auth.session_token=${COOKIE_SENTINEL}`)
			.expect(HttpStatus.SERVICE_UNAVAILABLE)

		expect(JSON.stringify(response.body)).not.toContain(COOKIE_SENTINEL)
		expect(JSON.stringify(response.body)).not.toContain(RAW_ERROR_SENTINEL)
		expect(response.headers["set-cookie"]).toBeUndefined()
	})

	it("bounds an induced repository failure in the production HTTP response and Pino log", async () => {
		const repository = app.get(BundleRepository)
		const originalRead = repository.readCurrentReadyEnvelope
		const capturedWrites: string[] = []
		const stdoutWrite = jest.spyOn(process.stdout, "write").mockImplementation(((
			chunk: string | Uint8Array
		) => {
			capturedWrites.push(String(chunk))
			return true
		}) as typeof process.stdout.write)
		try {
			repository.readCurrentReadyEnvelope = async () => {
				throw new Error(RAW_ERROR_SENTINEL)
			}
			const response = await request(app.getHttpServer())
				.get("/api/v1/pisocamp/bundle/manifest")
				.expect(HttpStatus.SERVICE_UNAVAILABLE)
			await new Promise(resolve => setImmediate(resolve))

			expect(response.body).toMatchObject({
				success: false,
				error: {
					code: "ServiceUnavailableException",
					message: "Bundle manifest is temporarily unavailable",
				},
			})
			expect(JSON.stringify(response.body)).not.toContain(RAW_ERROR_SENTINEL)
			expect(JSON.stringify(response.headers)).not.toContain(RAW_ERROR_SENTINEL)
			expect(capturedWrites.join("")).toContain("/api/v1/pisocamp/bundle/manifest")
			expect(capturedWrites.join("")).not.toContain(RAW_ERROR_SENTINEL)
		} finally {
			repository.readCurrentReadyEnvelope = originalRead
			stdoutWrite.mockRestore()
		}
	})

	it("serves only the current ready envelope with a strong exact-body validator", async () => {
		const now = new Date("2026-08-28T00:00:00.000Z")
		await db.insert(contentBundles).values({ state: "building", createdAt: now })
		await db.insert(contentBundles).values({
			state: "failed",
			failureCode: "bundle_build_failed",
			createdAt: now,
			failedAt: now,
		})
		const [building] = await db
			.insert(contentBundles)
			.values({ state: "building", createdAt: now })
			.returning({ id: contentBundles.id, version: contentBundles.version })
		expect(building).toBeDefined()

		const manifestJson = JSON.stringify({
			schemaVersion: 1,
			bundleVersion: building!.version.toString(),
			generatedAt: now.toISOString(),
			minimumClientSchemaVersion: 1,
			entries: [
				{
					logicalId: "seed.image.range",
					kind: "image",
					delivery: "core",
					mediaType: "image/png",
					byteLength: RESOURCE_BYTES.byteLength,
					sha256: RESOURCE_SHA256,
					downloadPath: `/pisocamp/bundle/resources/${RESOURCE_SHA256}`,
				},
			],
		})
		const payloadBytes = Buffer.from(manifestJson, "utf8")
		envelope = {
			schemaVersion: 1,
			algorithm: "Ed25519",
			keyId: fixture.keyId,
			payload: payloadBytes.toString("base64url"),
			signature: sign(null, payloadBytes, createPrivateKey(fixture.privateKeyPkcs8Pem)).toString(
				"base64url"
			),
		}

		await db.insert(contentBundleBlobs).values({
			sha256: RESOURCE_SHA256,
			byteLength: RESOURCE_BYTES.byteLength,
			mediaType: "image/png",
			body: RESOURCE_BYTES,
		})
		await db.insert(contentBundleManifestEntries).values({
			bundleId: building!.id,
			logicalId: "seed.image.range",
			position: 0,
			kind: "image",
			delivery: "core",
			mediaType: "image/png",
			byteLength: RESOURCE_BYTES.byteLength,
			sha256: RESOURCE_SHA256,
			downloadPath: `/pisocamp/bundle/resources/${RESOURCE_SHA256}`,
		})
		await db
			.update(contentBundles)
			.set({
				state: "ready",
				manifestPayload: envelope.payload,
				manifestSha256: createHash("sha256").update(payloadBytes).digest("hex"),
				algorithm: envelope.algorithm,
				keyId: envelope.keyId,
				signature: envelope.signature,
				entryCount: 1,
				coreByteLength: RESOURCE_BYTES.byteLength,
				readyAt: now,
			})
			.where(eq(contentBundles.id, building!.id))
		await db.insert(contentBundleChannels).values({
			id: "primary",
			currentBundleId: building!.id,
			updatedAt: now,
		})

		const response = await request(app.getHttpServer())
			.get("/api/v1/pisocamp/bundle/manifest")
			.set("Cookie", `better-auth.session_token=${COOKIE_SENTINEL}`)
			.expect(HttpStatus.OK)
		const exactBody = JSON.stringify(envelope)
		const etag = `"${createHash("sha256").update(exactBody).digest("hex")}"`

		expect(response.body).toEqual(envelope)
		expect(response.text).toBe(exactBody)
		expect(response.headers["cache-control"]).toBe("no-cache")
		expect(response.headers.etag).toBe(etag)
		expect(response.headers["set-cookie"]).toBeUndefined()
		expect(exactBody).not.toContain(COOKIE_SENTINEL)
		expect(exactBody).not.toContain(RAW_ERROR_SENTINEL)
		expect(exactBody).not.toContain("actorId")
		expect(exactBody).not.toContain("comments")
		expect(exactBody).not.toContain("storageKey")
		expect(exactBody).not.toContain(fixture.privateKeyPkcs8Pem)

		const notModified = await request(app.getHttpServer())
			.get("/api/v1/pisocamp/bundle/manifest")
			.set("If-None-Match", `"other", ${etag}`)
			.expect(HttpStatus.NOT_MODIFIED)
		expect(notModified.text).toBe("")
		expect(notModified.headers.etag).toBe(etag)
		expect(notModified.headers["cache-control"]).toBe("no-cache")

		const weakNotModified = await request(app.getHttpServer())
			.get("/api/v1/pisocamp/bundle/manifest")
			.set("If-None-Match", `"other", W/${etag}`)
			.expect(HttpStatus.NOT_MODIFIED)
		expect(weakNotModified.text).toBe("")
		expect(weakNotModified.headers.etag).toBe(etag)
		expect(weakNotModified.headers["cache-control"]).toBe("no-cache")
	})

	it("streams anonymous immutable resources byte-exactly with single-range semantics", async () => {
		const server = app.getHttpServer()
		const path = `/api/v1/pisocamp/bundle/resources/${RESOURCE_SHA256}`
		const full = await request(server).get(path).expect(HttpStatus.OK)
		expect(full.body).toEqual(RESOURCE_BYTES)
		expect(full.headers).toMatchObject({
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=31536000, immutable",
			"content-length": String(RESOURCE_BYTES.byteLength),
			"content-type": "image/png",
			"etag": `"${RESOURCE_SHA256}"`,
			"x-content-type-options": "nosniff",
		})

		const ranged = await request(server)
			.get(path)
			.set("Range", "bytes=8-")
			.set("Accept-Encoding", "gzip")
			.expect(HttpStatus.PARTIAL_CONTENT)
		expect(ranged.body).toEqual(RESOURCE_BYTES.subarray(8))
		expect(ranged.headers["content-range"]).toBe(
			`bytes 8-${RESOURCE_BYTES.byteLength - 1}/${RESOURCE_BYTES.byteLength}`
		)
		expect(ranged.headers["content-length"]).toBe(String(RESOURCE_BYTES.byteLength - 8))
		expect(ranged.headers["content-encoding"]).toBe("identity")

		const head = await request(server).head(path).set("Range", "bytes=8-").expect(HttpStatus.OK)
		expect(head.text ?? "").toBe("")
		expect(head.headers).toMatchObject({
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=31536000, immutable",
			"content-length": String(RESOURCE_BYTES.byteLength),
			"content-type": "image/png",
			"etag": `"${RESOURCE_SHA256}"`,
			"x-content-type-options": "nosniff",
		})
		expect(head.headers["content-range"]).toBeUndefined()

		const unsatisfiable = await request(server)
			.get(path)
			.set("Range", "bytes=0-1,3-4")
			.expect(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
		expect(unsatisfiable.text ?? "").toBe("")
		expect(unsatisfiable.headers["content-range"]).toBe(`bytes */${RESOURCE_BYTES.byteLength}`)
	})

	it("returns indistinguishable bodyless 404s for invalid and unknown opaque digests", async () => {
		const server = app.getHttpServer()
		for (const digest of ["INVALID", "f".repeat(64)]) {
			const response = await request(server)
				.get(`/api/v1/pisocamp/bundle/resources/${digest}`)
				.expect(HttpStatus.NOT_FOUND)
			expect(response.text).toBe("")
			expect(JSON.stringify(response.headers)).not.toContain(RAW_ERROR_SENTINEL)
		}
	})
})
