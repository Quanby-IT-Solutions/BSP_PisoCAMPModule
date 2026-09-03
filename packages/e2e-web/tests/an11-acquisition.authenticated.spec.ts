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

const HEADER = "source,periodStart,periodEnd,installs,uninstalls,ratingAverage,ratingCount"

/**
 * AN-11 in a real browser.
 *
 * The arithmetic is asserted in the backend suite; this proves the page names
 * the source of its install figure, refuses a malformed report, and imports a
 * good one.
 */
test.describe("AN-11 acquisition", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("names the source of the install figure and keeps the counts apart", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/acquisition")
		await expect(
			page.getByRole("heading", { name: "Acquisition", level: 1 })
		).toBeVisible()
		await page.waitForLoadState("networkidle")

		await expect(page.getByText("Install volume", { exact: true })).toBeVisible({
			timeout: 20_000,
		})
		await expect(page.getByText("First opens (devices)")).toBeVisible()
		await expect(page.getByText("The two counts are not added together")).toBeVisible()
		await expect(page.getByText("Combined", { exact: true })).toBeVisible()

		expectClean(observed)
	})

	test("refuses a report whose header is wrong", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "admin")

		await page.goto("/pisocamp/acquisition")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Or paste the rows").fill("installs\n5")
		await page.getByRole("button", { name: "Import Report" }).click()

		await expect(page.locator("#store-import-error")).toContainText(
			"The first line must be exactly"
		)

		expectClean(observed)
	})

	test("imports a store report and shows it", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "admin")

		await page.goto("/pisocamp/acquisition")
		await page.waitForLoadState("networkidle")

		// A period inside the default range, which ends today in Manila.
		const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
		await page
			.getByLabel("Or paste the rows")
			.fill(`${HEADER}\ngoogle_play,${today},${today},1200,40,4.4,100`)
		await page.getByRole("button", { name: "Import Report" }).click()

		await expect(page.getByText(/Imported 1 period/)).toBeVisible({ timeout: 20_000 })
		await expect(page.getByRole("cell", { name: "Google Play" })).toBeVisible()
		await expect(page.getByText("Store reports (Google Play)").first()).toBeVisible()

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/acquisition")
		await expect(page.getByRole("heading", { name: "Acquisition" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const from = page.getByLabel("From", { exact: true })
		await from.focus()
		await expect(from).toBeFocused()
		expect((await from.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the page to a user without reports.dashboards.view", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		await page.goto("/pisocamp/acquisition")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Acquisition" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
