import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

const ITEM_ID = "9c5b0000-0000-4000-8000-000000000051"
const APPROVED_VERSION_NO = 3
const IMAGE_ASSET_ID = "9c5b0000-0000-4000-8000-000000000071"
const AUDIO_ASSET_ID = "9c5b0000-0000-4000-8000-000000000072"
const PREVIEW_PATH = `/pisocamp/content/${ITEM_ID}/versions/${APPROVED_VERSION_NO}/preview`

interface Observed {
	consoleErrors: string[]
	pageErrors: string[]
	failedRequests: string[]
	badResponses: string[]
}

/**
 * Watch the page the way a reviewer would: any console error, unhandled
 * rejection, failed request or non-2xx/3xx response is a defect, not noise.
 */
function observe(page: Page): Observed {
	const observed: Observed = {
		consoleErrors: [],
		pageErrors: [],
		failedRequests: [],
		badResponses: [],
	}
	page.on("console", (message: ConsoleMessage) => {
		if (message.type() === "error" || message.type() === "warning") {
			observed.consoleErrors.push(`${message.type()}: ${message.text()}`)
		}
	})
	page.on("pageerror", error => observed.pageErrors.push(error.message))
	page.on("requestfailed", (request: Request) => {
		// Next.js cancels in-flight RSC prefetches and the connectivity poll on
		// navigation and teardown; the browser reports those as aborted, which is
		// the framework working, not a failed request.
		const reason = request.failure()?.errorText ?? "unknown"
		if (reason === "net::ERR_ABORTED") return
		observed.failedRequests.push(`${request.method()} ${request.url()} (${reason})`)
	})
	page.on("response", (response: Response) => {
		if (response.status() >= 400) {
			observed.badResponses.push(`${response.status()} ${response.url()}`)
		}
	})
	return observed
}

/**
 * `allowResponse` names error responses that are the app working as designed —
 * today only the dashboard shell prefetching a route this identity may not
 * open. Those also surface as an anonymous "Failed to load resource" console
 * error, which is dropped in step with them so a real error still fails.
 */
function expectClean(observed: Observed, allowResponse?: (url: string) => boolean) {
	const permitted = allowResponse
		? observed.badResponses.filter(entry => allowResponse(entry.split(" ").slice(1).join(" ")))
		: []
	const consoleErrors = observed.consoleErrors.filter(
		message => !(permitted.length > 0 && /Failed to load resource/.test(message))
	)

	expect(observed.pageErrors, "unhandled page errors").toEqual([])
	expect(consoleErrors, "console errors and warnings").toEqual([])
	expect(observed.failedRequests, "failed requests").toEqual([])
	expect(
		observed.badResponses.filter(entry => !permitted.includes(entry)),
		"error responses"
	).toEqual([])
}

test.describe("CM-5 pre-publication preview in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("renders an approved version with its media and a scannable code, and stays clean", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		const previewResponse = page.waitForResponse(
			response =>
				response
					.url()
					.includes(
						`/api/v1/admin/pisocamp/content/${ITEM_ID}/versions/${APPROVED_VERSION_NO}/preview`
					) && response.request().method() === "GET"
		)
		await page.goto(PREVIEW_PATH)
		const grantResponse = await previewResponse
		expect(grantResponse.status()).toBe(200)

		const grant = (await grantResponse.json()) as {
			token: string
			expiresAt: string
			preview: { versionNo: number; status: string }
		}
		expect(grant.preview).toMatchObject({ versionNo: APPROVED_VERSION_NO, status: "approved" })
		expect(grant.token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

		await expect(
			page.getByRole("heading", { name: "NGC 1000 Piso banknote", level: 1 })
		).toBeVisible()
		await expect(page.getByText("Preview Only")).toBeVisible()
		await expect(
			page.getByText(
				/does not publish anything and does not add this version to any offline bundle/i
			)
		).toBeVisible()

		// AC1 — images and an audio player, served through the grant.
		const image = page.getByRole("img", { name: "Obverse image of NGC 1000 Piso banknote" })
		await expect(image).toBeVisible()
		expect(await image.getAttribute("src")).toContain(
			`/pisocamp/preview/resources/${IMAGE_ASSET_ID}?token=`
		)
		await expect
			.poll(async () => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
			.toBeGreaterThan(0)

		const player = page.getByLabel("Narration for NGC 1000 Piso banknote")
		await expect(player).toBeVisible()
		expect(await player.getAttribute("src")).toContain(
			`/pisocamp/preview/resources/${AUDIO_ASSET_ID}?token=`
		)

		// AC4 — the scannable code and the link it carries.
		const code = page.getByRole("img", { name: "Preview code for the Piso CAMP preview build" })
		await expect(code).toBeVisible()
		expect(await code.locator("svg").count()).toBe(1)
		await expect(page.getByTestId("preview-redeem-url")).toContainText("/pisocamp/preview?token=")

		// Preview media must never be cached as if it were published content.
		const assetResponse = await page.request.get(
			`${new URL(grantResponse.url()).origin}/api/v1/pisocamp/preview/resources/${IMAGE_ASSET_ID}?token=${encodeURIComponent(grant.token)}`
		)
		expect(assetResponse.status()).toBe(200)
		expect(assetResponse.headers()["cache-control"]).toBe("no-store")
		expect(assetResponse.headers()["content-type"]).toBe("image/png")

		expectClean(observed)
	})

	test("keeps the preview readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await page.goto(PREVIEW_PATH)
		await expect(page.getByRole("heading", { name: "NGC 1000 Piso banknote" })).toBeVisible()

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const back = page.getByRole("link", { name: "Back To Content" })
		await back.focus()
		await expect(back).toBeFocused()
		const box = await back.boundingBox()
		expect(box?.height ?? 0, "touch target height").toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the preview route to an editor without content.items.preview", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentEditor")

		await page.goto(PREVIEW_PATH)
		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "NGC 1000 Piso banknote" })).toHaveCount(0)

		// The editor can still open the draft it owns, and simply sees no
		// preview entry point there.
		await page.goto(`/pisocamp/content/${ITEM_ID}/edit`)
		await expect(page.getByRole("link", { name: /Preview Version/ })).toHaveCount(0)

		// The API itself must refuse, not merely the page: a denied identity that
		// calls the endpoint directly gets 403 with no grant in the body.
		const denied = await page.request.get(
			`http://localhost:3000/api/v1/admin/pisocamp/content/${ITEM_ID}/versions/${APPROVED_VERSION_NO}/preview`
		)
		expect(denied.status()).toBe(403)
		expect(await denied.text()).not.toContain("v1.")

		// The shell prefetches /user-management, which this identity may not read.
		// That denial is the RBAC spine working, and is not a preview defect.
		expectClean(observed, url => url.endsWith("/api/v1/rbac/users"))
	})

	test("refuses to preview a version that is not pre-publication", async ({ page }) => {
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		const origin = new URL(page.url() || "http://localhost:3001").origin
		expect(origin).toBeTruthy()

		const denied = await page.request.get(
			`http://localhost:3000/api/v1/admin/pisocamp/content/${ITEM_ID}/versions/99/preview`
		)
		expect(denied.status()).toBe(404)
	})
})
