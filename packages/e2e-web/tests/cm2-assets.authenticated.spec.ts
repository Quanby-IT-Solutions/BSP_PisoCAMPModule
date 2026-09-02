import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { deflateSync } from "node:zlib"
import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

const ITEM_ID = "8a810000-0000-4000-8000-000000000001"
const API_BASE = process.env.CM2_E2E_API_BASE ?? "http://localhost:3000/api/v1"
const ARTIFACT_DIR = process.env.CM2_ARTIFACT_DIR
const UPLOAD_PATH = "/api/v1/admin/pisocamp/assets"

interface AssetMetadata {
	id: string
	sha256: string
	mediaType: string
	byteLength: number
}

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

const png = (extra = Buffer.alloc(0)) => {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(1, 0)
	ihdr.writeUInt32BE(1, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		...(extra.length ? [pngChunk("tEXt", extra)] : []),
		pngChunk("IDAT", deflateSync(Buffer.alloc(5))),
		pngChunk("IEND"),
	])
}

const oversizedPng = () => {
	const withoutAncillary = png()
	return png(Buffer.alloc(10_485_761 - withoutAncillary.length - 12, 0x61))
}

const mp3 = () => {
	const bytes = Buffer.alloc(417)
	bytes.set([0xff, 0xfb, 0x90, 0x00])
	return bytes
}

const glb = () => {
	const document = {
		asset: { version: "2.0" },
		buffers: [{ byteLength: 1 }],
		bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 1 }],
	}
	const jsonText = JSON.stringify(document)
	const json = Buffer.from(jsonText.padEnd(Math.ceil(jsonText.length / 4) * 4, " "))
	const binary = Buffer.alloc(4)
	const bytes = Buffer.alloc(28 + json.length + binary.length)
	bytes.write("glTF", 0, "ascii")
	bytes.writeUInt32LE(2, 4)
	bytes.writeUInt32LE(bytes.length, 8)
	bytes.writeUInt32LE(json.length, 12)
	bytes.writeUInt32LE(0x4e4f534a, 16)
	json.copy(bytes, 20)
	const binaryOffset = 20 + json.length
	bytes.writeUInt32LE(binary.length, binaryOffset)
	bytes.writeUInt32LE(0x004e4942, binaryOffset + 4)
	binary.copy(bytes, binaryOffset + 8)
	return bytes
}

const usdz = () => {
	const name = Buffer.from("scene.usda")
	const body = Buffer.from("#usda 1.0\n")
	const extraLength = (64 - ((30 + name.length) % 64)) % 64
	const extra = Buffer.alloc(extraLength)
	if (extraLength >= 4) {
		extra.writeUInt16LE(0x1986, 0)
		extra.writeUInt16LE(extraLength - 4, 2)
	}
	const checksum = crc32(body)
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt16LE(20, 4)
	local.writeUInt32LE(checksum, 14)
	local.writeUInt32LE(body.length, 18)
	local.writeUInt32LE(body.length, 22)
	local.writeUInt16LE(name.length, 26)
	local.writeUInt16LE(extra.length, 28)
	const central = Buffer.alloc(46)
	central.writeUInt32LE(0x02014b50, 0)
	central.writeUInt16LE(20, 4)
	central.writeUInt16LE(20, 6)
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

const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer })

function isUpload(request: Request) {
	return request.method() === "POST" && new URL(request.url()).pathname === UPLOAD_PATH
}

function collectRuntimeFailures(page: Page) {
	const consoleFailures: string[] = []
	const expectedConsoleFailures: string[] = []
	const pageErrors: string[] = []
	const failedRequests: string[] = []
	const unexpectedResponses: string[] = []
	const expectedNegativeStatuses = new Set([400, 403, 409, 413])
	const expectedNegativeConsoleMessages = new Set([
		"[error] Failed to load resource: the server responded with a status of 400 (Bad Request)",
		"[error] Failed to load resource: the server responded with a status of 409 (Conflict)",
		"[error] Failed to load resource: the server responded with a status of 413 (Payload Too Large)",
		"[error] Failed to load resource: net::ERR_FAILED",
	])

	page.on("console", message => {
		if (message.type() === "error" || message.type() === "warning") {
			const observed = `[${message.type()}] ${message.text()}`
			if (expectedNegativeConsoleMessages.has(observed)) expectedConsoleFailures.push(observed)
			else consoleFailures.push(observed)
		}
	})
	page.on("pageerror", error => pageErrors.push(error.message))
	page.on("requestfailed", request => {
		if (isUpload(request) && request.failure()?.errorText === "net::ERR_FAILED") return
		if (request.failure()?.errorText === "net::ERR_ABORTED") return
		failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`)
	})
	page.on("response", response => {
		if (response.status() < 400 || expectedNegativeStatuses.has(response.status())) return
		unexpectedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
	})

	return {
		consoleFailures,
		expectedConsoleFailures,
		pageErrors,
		failedRequests,
		unexpectedResponses,
	}
}

async function selectRole(page: Page, label: string) {
	const role = page.getByRole("combobox", { name: "Asset role" })
	if ((await role.textContent())?.trim() === label) return
	await role.focus()
	await role.press("Enter")
	await page.getByRole("option", { name: label }).press("Enter")
}

async function uploadViaKeyboard(
	page: Page,
	role: string,
	payload: ReturnType<typeof file>,
	mediaType: string
) {
	await selectRole(page, role)
	const input = page.getByLabel("Asset file")
	await input.focus()
	await input.setInputFiles(payload)
	const upload = page.getByRole("button", { name: "Upload asset" })
	await expect(upload).toBeEnabled()
	await upload.focus()
	await upload.press("Enter")
	const attachment = page.getByRole("group", { name: `${role} attachment` })
	await expect(attachment).toContainText(mediaType, { timeout: 30_000 })
	return attachment
}

async function pressConfirmed(page: Page, triggerName: string, confirmationName: string) {
	const trigger = page.getByRole("button", { name: triggerName })
	await trigger.focus()
	await trigger.press("Enter")
	const confirmation = page.getByRole("button", { name: confirmationName })
	await expect(confirmation).toBeVisible()
	await confirmation.focus()
	await confirmation.press("Enter")
}

async function currentVersion(page: Page) {
	const response = await page
		.context()
		.request.get(`${API_BASE}/admin/pisocamp/content/${ITEM_ID}`, {
			headers: { Origin: "http://localhost:3001" },
		})
	expect(response.status()).toBe(200)
	const body = (await response.json()) as {
		currentVersion: { versionNo: number; content: unknown; relatedLinks: unknown[] }
	}
	return body.currentVersion
}

async function captureScreenshot(page: Page, name: string) {
	if (!ARTIFACT_DIR) return
	await page.screenshot({ path: path.join(ARTIFACT_DIR, name), fullPage: true })
}

test.describe("CM-2 governed assets with real sessions", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })
	test.setTimeout(600_000)

	test("proves governed upload, immutable workflow, denial, idempotency, and accessibility", async ({
		page,
	}) => {
		if (ARTIFACT_DIR) {
			await mkdir(ARTIFACT_DIR, { recursive: true })
		}
		const failures = collectRuntimeFailures(page)

		await signInAs(page, "contentAdmin")
		await page.goto(`/pisocamp/content/${ITEM_ID}/edit`)
		await expect(page.getByRole("heading", { name: "Draft assets" })).toBeVisible()
		await expect(page.getByText(/^Images: PNG, JPEG, or WebP/)).toBeVisible()
		const fileInput = page.getByLabel("Asset file")
		await expect(fileInput).toHaveAttribute("aria-describedby", "asset-policy-guidance")

		for (const control of [
			page.getByRole("combobox", { name: "Asset role" }),
			fileInput,
			page.getByRole("button", { name: "Upload asset" }),
		]) {
			const box = await control.boundingBox()
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
		}

		const title = page.getByLabel("Title")
		await title.fill(`${await title.inputValue()} updated`)
		await expect(page.getByText("Save your content changes before managing assets.")).toBeVisible()
		await expect(fileInput).toBeDisabled()
		await page.getByRole("button", { name: "Save Draft" }).press("Enter")
		await expect(page).toHaveURL(/\/pisocamp\/content$/)
		await page.goto(`/pisocamp/content/${ITEM_ID}/edit`)
		await expect(fileInput).toBeEnabled()

		const imageBytes = png()
		await uploadViaKeyboard(
			page,
			"Obverse",
			file("valid-image.png", "image/png", imageBytes),
			"image/png"
		)
		await uploadViaKeyboard(
			page,
			"Audio",
			file("valid-audio.mp3", "audio/mpeg", mp3()),
			"audio/mpeg"
		)

		const glbBytes = glb()
		const glbDigest = createHash("sha256").update(glbBytes).digest("hex")
		await uploadViaKeyboard(
			page,
			"Animation",
			file("valid-model.glb", "model/gltf-binary", glbBytes),
			"model/gltf-binary"
		)
		await pressConfirmed(page, "Detach animation asset", "Confirm detach")
		await expect(page.getByRole("group", { name: "Animation attachment" })).toHaveCount(0, {
			timeout: 30_000,
		})
		await expect(
			page.getByRole("group", { name: `Available asset ${glbDigest.slice(0, 12)}` })
		).toBeVisible()

		const usdzBytes = usdz()
		const usdzDigest = createHash("sha256").update(usdzBytes).digest("hex")
		await uploadViaKeyboard(
			page,
			"Animation",
			file("valid-ar.usdz", "model/vnd.usdz+zip", usdzBytes),
			"model/vnd.usdz+zip"
		)
		await pressConfirmed(page, "Detach animation asset", "Confirm detach")
		await expect(page.getByRole("group", { name: "Animation attachment" })).toHaveCount(0, {
			timeout: 30_000,
		})
		const glbAvailable = page.getByRole("group", {
			name: `Available asset ${glbDigest.slice(0, 12)}`,
		})
		const attachGlb = glbAvailable.getByRole("button", { name: "Attach as animation" })
		await attachGlb.focus()
		await attachGlb.press("Enter")
		await expect(page.getByRole("group", { name: "Animation attachment" })).toContainText(
			"model/gltf-binary",
			{ timeout: 30_000 }
		)
		await pressConfirmed(page, "Delete animation asset", "Confirm delete")
		await expect(glbAvailable).toHaveCount(0, { timeout: 30_000 })
		const usdzAvailable = page.getByRole("group", {
			name: `Available asset ${usdzDigest.slice(0, 12)}`,
		})
		const attachUsdz = usdzAvailable.getByRole("button", { name: "Attach as animation" })
		await attachUsdz.focus()
		await attachUsdz.press("Enter")
		await expect(page.getByRole("group", { name: "Animation attachment" })).toContainText(
			"model/vnd.usdz+zip",
			{ timeout: 30_000 }
		)

		await selectRole(page, "Edge")
		await fileInput.setInputFiles(file("spoof.png", "image/png", Buffer.from("not an image")))
		await page.getByRole("button", { name: "Upload asset" }).press("Enter")
		const invalid = page.getByRole("alert").filter({ hasText: "Asset Update Not Completed" })
		await expect(invalid).toContainText("The file is invalid or does not match the selected role.")
		await expect(invalid).toBeFocused()
		expect(await fileInput.evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe(
			"spoof.png"
		)

		await fileInput.setInputFiles(file("oversize.png", "image/png", oversizedPng()))
		await page.getByRole("button", { name: "Upload asset" }).press("Enter")
		await expect(invalid).toContainText("The file exceeds the allowed size for its format.")

		const beforeStale = await currentVersion(page)
		const updateRequestId = crypto.randomUUID()
		const externalUpdate = await page
			.context()
			.request.put(`${API_BASE}/admin/pisocamp/content/${ITEM_ID}`, {
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": updateRequestId,
					"Origin": "http://localhost:3001",
				},
				data: {
					itemId: ITEM_ID,
					requestId: updateRequestId,
					expectedVersionNo: beforeStale.versionNo,
					content: beforeStale.content,
					relatedLinks: beforeStale.relatedLinks,
				},
			})
		expect(externalUpdate.status()).toBe(200)
		await fileInput.setInputFiles(file("stale.png", "image/png", png()))
		await page.getByRole("button", { name: "Upload asset" }).press("Enter")
		await expect(invalid).toContainText("Reload the latest version")
		await expect(fileInput).toBeDisabled()
		const reload = page.getByRole("button", { name: "Reload latest assets" })
		await expect(reload).toBeEnabled()
		await reload.press("Enter")
		await expect(invalid).toHaveCount(0)
		await expect(fileInput).toBeEnabled()

		await selectRole(page, "Texture")
		const retryBytes = png(Buffer.from("retry-proof"))
		await fileInput.setInputFiles(file("retry.png", "image/png", retryBytes))
		let firstResponseBody: Buffer | undefined
		let retainedIdempotencyKey: string | undefined
		let firstUpload = true
		await page.route(`**${UPLOAD_PATH}`, async route => {
			if (!firstUpload) {
				await route.continue()
				return
			}
			firstUpload = false
			retainedIdempotencyKey = route.request().headers()["idempotency-key"]
			const response = await route.fetch()
			firstResponseBody = await response.body()
			await route.abort("failed")
		})
		await page.getByRole("button", { name: "Upload asset" }).press("Enter")
		await expect(invalid).toContainText("Check your connection and try again")
		const retryResponsePromise = page.waitForResponse(
			(response: Response) => isUpload(response.request()) && response.status() === 200
		)
		await page.getByRole("button", { name: "Upload asset" }).press("Enter")
		const retryResponse = await retryResponsePromise
		expect(await retryResponse.body()).toEqual(firstResponseBody)
		expect(retainedIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
		await page.unroute(`**${UPLOAD_PATH}`)
		await expect(page.getByRole("group", { name: "Texture attachment" })).toContainText("image/png")

		const changedRetry = await page.context().request.post(`${API_BASE}/admin/pisocamp/assets`, {
			headers: {
				"Idempotency-Key": retainedIdempotencyKey!,
				"Origin": "http://localhost:3001",
			},
			multipart: {
				file: file("changed.png", "image/png", png(Buffer.from("changed-input"))),
				itemId: ITEM_ID,
				expectedVersionNo: String((await currentVersion(page)).versionNo),
				role: "edge",
				requestId: retainedIdempotencyKey!,
			},
		})
		expect(changedRetry.status()).toBe(409)

		await page.setViewportSize({ width: 320, height: 720 })
		const overflow = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}))
		expect(overflow.scrollWidth).toBe(overflow.clientWidth)
		await captureScreenshot(page, "cm2-assets-mobile-draft.png")

		await page.getByRole("button", { name: "Submit for Review" }).press("Enter")
		await page.getByRole("button", { name: "Confirm Submission" }).press("Enter")
		await expect(page).toHaveURL(/\/pisocamp\/content$/)

		await signOutCompletely(page)
		await signInAs(page, "contentApprover")
		await page.goto(`/pisocamp/content/review/${ITEM_ID}`)
		await page.getByLabel("Review comments").fill("CM-2 acceptance approval")
		await page.getByRole("button", { name: "Approve" }).press("Enter")
		await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible()
		await page.getByRole("button", { name: "Publish Approved Version" }).press("Enter")
		await page.getByRole("button", { name: "Confirm Publication" }).press("Enter")
		await expect(page.getByText("Published", { exact: true }).first()).toBeVisible()
		await captureScreenshot(page, "cm2-assets-published.png")

		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const assetsResponse = await page
			.context()
			.request.get(`${API_BASE}/admin/pisocamp/content/${ITEM_ID}/assets`, {
				headers: { Origin: "http://localhost:3001" },
			})
		expect(assetsResponse.status()).toBe(200)
		const listed = (await assetsResponse.json()) as {
			currentVersionNo: number
			attachments: Array<{ role: string; asset: AssetMetadata }>
		}
		const publishedAsset = listed.attachments.find(entry => entry.role === "obverse")?.asset
		expect(publishedAsset).toBeDefined()
		const deleteRequestId = crypto.randomUUID()
		const blockedDelete = await page
			.context()
			.request.delete(`${API_BASE}/admin/pisocamp/assets/${publishedAsset!.id}`, {
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": deleteRequestId,
					"Origin": "http://localhost:3001",
				},
				data: {
					assetId: publishedAsset!.id,
					itemId: ITEM_ID,
					expectedVersionNo: listed.currentVersionNo,
					requestId: deleteRequestId,
				},
			})
		expect(blockedDelete.status()).toBe(409)
		expect(await blockedDelete.text()).toContain("Published content references this asset")

		await signOutCompletely(page)
		await signInAs(page, "contentEditor")
		await page.goto(`/pisocamp/content/${ITEM_ID}/edit`)
		await expect(page.getByRole("heading", { name: "Draft assets" })).toHaveCount(0)
		const deniedRequestId = crypto.randomUUID()
		const denied = await page.context().request.post(`${API_BASE}/admin/pisocamp/assets`, {
			headers: {
				"Idempotency-Key": deniedRequestId,
				"Origin": "http://localhost:3001",
			},
			multipart: {
				file: file("denied.bin", "application/octet-stream", Buffer.alloc(2_000_000, 0x78)),
				itemId: ITEM_ID,
				expectedVersionNo: String(listed.currentVersionNo),
				role: "obverse",
				requestId: deniedRequestId,
			},
		})
		expect(denied.status()).toBe(403)
		await captureScreenshot(page, "cm2-assets-editor-without-upload.png")

		expect(failures.consoleFailures).toEqual([])
		expect(failures.expectedConsoleFailures).toEqual([
			"[error] Failed to load resource: the server responded with a status of 400 (Bad Request)",
			"[error] Failed to load resource: the server responded with a status of 413 (Payload Too Large)",
			"[error] Failed to load resource: the server responded with a status of 409 (Conflict)",
			"[error] Failed to load resource: net::ERR_FAILED",
		])
		expect(failures.pageErrors).toEqual([])
		expect(failures.failedRequests).toEqual([])
		expect(failures.unexpectedResponses).toEqual([])
	})
})
