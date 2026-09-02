import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

const ITEM_ID = "9c5b0000-0000-4000-8000-000000000052"
const HISTORY_PATH = `/pisocamp/content/${ITEM_ID}/versions`
const API_ORIGIN = process.env.CM4_E2E_API_ORIGIN ?? "http://localhost:3000"

interface Observed {
	consoleErrors: string[]
	pageErrors: string[]
	failedRequests: string[]
	badResponses: string[]
}

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

test.describe("CM-4 version history and restore in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("shows the full history with actors, status and a difference, then restores", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto(HISTORY_PATH)
		await expect(page.getByRole("heading", { name: "Version History", level: 1 })).toBeVisible()
		// Let the shell finish its route prefetching before driving the dialog.
		await page.waitForLoadState("networkidle")

		// Newest first, and every seeded version present. Asserted by order rather
		// than by an exact list: this acceptance database is cumulative, so a
		// previous run's restore legitimately adds versions above 4.
		const headings = await page.getByRole("heading", { level: 2 }).allTextContents()
		const versionNumbers = headings.map(text => Number(text.replace("Version ", "")))
		expect(versionNumbers).toEqual([...versionNumbers].sort((a, b) => b - a))
		expect(versionNumbers).toEqual(expect.arrayContaining([4, 3, 2, 1]))

		// AC1 — creator, date, approver and status on the published version.
		const live = page.getByRole("heading", { name: "Version 4" }).locator("../..")
		await expect(live.getByText("Published", { exact: true })).toBeVisible()
		await expect(live.getByText("Live", { exact: true })).toBeVisible()
		await expect(live.getByText("Admin User", { exact: false }).first()).toBeVisible()

		// AC1 — a field-level difference on an older version.
		const differences = page.getByRole("region", { name: "Differences for version 1" })
		await expect(differences.getByText("Summary")).toBeVisible()
		await expect(differences.getByText(/First draft of the handling advisory\./)).toBeVisible()

		// AC2 — restoring an approved version produces a new approved version and
		// does NOT publish it.
		const restoreResponse = page.waitForResponse(
			response =>
				response.url().includes("/versions/3/restore") && response.request().method() === "POST"
		)
		// Driven by keyboard, which is both the accessibility check and the
		// interaction Playwright can perform without waiting on the app shell's
		// route prefetching.
		const trigger = page.getByRole("button", { name: "Restore Version 3" })
		await trigger.focus()
		await trigger.press("Enter")
		const reason = page.getByLabel("Reason for restoring")
		await expect(reason).toBeVisible()
		await reason.fill("Reverting to the approved copy.")
		const confirm = page.getByRole("button", { name: "Confirm Restore" })
		await expect(confirm).toBeEnabled()
		await confirm.focus()
		await confirm.press("Enter")

		const restored = await restoreResponse
		expect(restored.status()).toBe(200)
		const detail = (await restored.json()) as {
			status: string
			currentVersion: { versionNo: number; publication: unknown }
		}
		expect(detail.status).toBe("approved")
		expect(detail.currentVersion.versionNo).toBeGreaterThan(4)
		expect(detail.currentVersion.publication).toBeNull()

		// Scoped to the page's own status region: the toast repeats the wording.
		const restoredStatus = page.getByRole("status").filter({ hasText: "Version Restored" })
		await expect(restoredStatus).toBeVisible()
		await expect(restoredStatus).toContainText(/Publish it to make it live/i)
		const newest = page.getByRole("heading", {
			name: `Version ${detail.currentVersion.versionNo}`,
		})
		await expect(newest).toBeVisible()
		await expect(newest.locator("../..").getByText("Restored from version 3")).toBeVisible()
		await expect(newest.locator("../..").getByText("Approved", { exact: true })).toBeVisible()

		expectClean(observed)
	})

	test("keeps history readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await page.goto(HISTORY_PATH)
		await expect(page.getByRole("heading", { name: "Version History" })).toBeVisible()

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const back = page.getByRole("link", { name: "Back To Content" })
		await back.focus()
		await expect(back).toBeFocused()
		const box = await back.boundingBox()
		expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses history and restore to an editor without content.items.restore", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentEditor")

		await page.goto(HISTORY_PATH)
		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Version History" })).toHaveCount(0)

		const deniedList = await page.request.get(
			`${API_ORIGIN}/api/v1/admin/pisocamp/content/${ITEM_ID}/versions`
		)
		expect(deniedList.status()).toBe(403)

		const deniedRestore = await page.request.post(
			`${API_ORIGIN}/api/v1/admin/pisocamp/content/${ITEM_ID}/versions/3/restore`,
			{
				headers: { "Idempotency-Key": "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f" },
				data: {
					itemId: ITEM_ID,
					versionNo: 3,
					requestId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
					expectedVersionNo: 5,
					comments: "Attempted without permission.",
				},
			}
		)
		expect(deniedRestore.status()).toBe(403)

		expectClean(observed, url => url.endsWith("/api/v1/rbac/users"))
	})
})
