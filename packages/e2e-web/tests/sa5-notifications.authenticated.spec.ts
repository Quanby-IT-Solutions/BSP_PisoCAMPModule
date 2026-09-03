import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

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

function expectClean(observed: Observed) {
	expect(observed.pageErrors, "unhandled page errors").toEqual([])
	expect(observed.consoleErrors, "console errors and warnings").toEqual([])
	expect(observed.failedRequests, "failed requests").toEqual([])
	expect(observed.badResponses, "error responses").toEqual([])
}

/**
 * SA-5 in a real browser.
 *
 * The rates are computed and asserted in the backend suite; this proves the
 * page shows them with their pools, asks before sending to everybody, and
 * records a send.
 */
test.describe("SA-5 notifications", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("shows every rate with the pool it came from", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/notifications")
		await expect(
			page.getByRole("heading", { name: "Notifications", level: 1 })
		).toBeVisible()
		await page.waitForLoadState("networkidle")

		await expect(page.getByText("Opt-in rate", { exact: true })).toBeVisible({ timeout: 20_000 })
		await expect(page.getByText("Delivery rate", { exact: true })).toBeVisible()
		await expect(page.getByText("Failed delivery rate", { exact: true })).toBeVisible()
		await expect(page.getByText("Open rate", { exact: true })).toBeVisible()
		await expect(page.getByText("Click rate", { exact: true })).toBeVisible()
		await expect(page.getByText("Re-engagement", { exact: true })).toBeVisible()
		await expect(page.getByText(/of \d+ registered/)).toBeVisible()

		expectClean(observed)
	})

	test("asks before sending, then records the send", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "admin")

		await page.goto("/pisocamp/notifications")
		await page.waitForLoadState("networkidle")

		const title = `Browser check ${Date.now()}`
		await page.getByLabel("Title").fill(title)
		await page.getByLabel("Message").fill("Sent by the SA-5 browser case.")
		await page.getByLabel("Approval reference").fill("BSP-COMMS-2026-E2E")
		await page.getByRole("button", { name: "Send", exact: true }).click()

		// A notification cannot be taken back, so it asks first.
		await expect(page.getByText("This goes to every opted-in device")).toBeVisible()
		await page.getByRole("button", { name: "Send Now" }).click()

		await expect(page.getByText(/Sent to|Queued for/)).toBeVisible({ timeout: 20_000 })
		await expect(page.getByRole("cell", { name: title })).toBeVisible()

		expectClean(observed)
	})

	test("refuses a deep link that is not an internal path", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "admin")

		await page.goto("/pisocamp/notifications")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Title").fill("Title")
		await page.getByLabel("Message").fill("Body")
		await page.getByLabel("Approval reference").fill("BSP-COMMS-2026-E2E")
		await page.getByLabel("Deep link (optional)").fill("https://example.test")
		await page.getByRole("button", { name: "Send", exact: true }).click()

		await expect(page.locator("#notification-error")).toContainText("internal path")
		await expect(page.getByText("This goes to every opted-in device")).toHaveCount(0)

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/notifications")
		await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const title = page.getByLabel("Title")
		await title.focus()
		await expect(title).toBeFocused()
		expect((await title.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the page to a user without reports.dashboards.view", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		await page.goto("/pisocamp/notifications")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Notifications" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
