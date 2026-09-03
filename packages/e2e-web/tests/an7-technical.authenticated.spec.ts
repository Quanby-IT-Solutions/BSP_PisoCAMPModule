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
 * AN-7 in a real browser.
 *
 * The figures themselves are reconciled in the backend suite; this proves the
 * page renders them, keeps the manual entry behind its own permission, and
 * stays usable at 320 px.
 */
test.describe("AN-7 technical health", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("shows crash, load, API and network figures", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/technical")
		await expect(
			page.getByRole("heading", { name: "Technical health", level: 1 })
		).toBeVisible()
		await page.waitForLoadState("networkidle")

		await expect(page.getByText("Crashes", { exact: true })).toBeVisible({
			timeout: 20_000,
		})
		await expect(page.getByText("Load time", { exact: true })).toBeVisible()
		await expect(page.getByText("API endpoints", { exact: true })).toBeVisible()
		await expect(page.getByText("Network failures", { exact: true })).toBeVisible()
		// Every kind is listed, including the ones nothing has reported.
		await expect(page.getByRole("cell", { name: "No connectivity" })).toBeVisible()
		await expect(page.getByRole("cell", { name: "Upload failed" })).toBeVisible()
		// Nothing imported reads differently from nothing having crashed.
		await expect(page.getByText(/Nothing has been imported for this range/)).toBeVisible()

		expectClean(observed)
	})

	test("refuses a range that ends before it starts", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/technical")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("From", { exact: true }).fill("2027-01-01")
		await page.getByRole("button", { name: "Apply Range" }).click()

		await expect(page.locator("#technical-range-error")).toHaveText(
			"The range must start on or before it ends."
		)

		expectClean(observed)
	})

	// Whether the entry form is offered at all is decided by
	// `admin.integrations.manage`, and both branches of that are proven against
	// the real guard in `monitoring.authorization.spec.ts`. Every seeded browser
	// persona that can read this page also holds that permission, so the browser
	// case exercises the side that can save a run.
	test("records a run for somebody who may enter one", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "admin")

		await page.goto("/pisocamp/technical")
		await page.waitForLoadState("networkidle")

		// Today in Manila, because a run tested in the future is correctly left
		// out of a range that ends today.
		const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
		await page.getByLabel("Tested on").fill(today)
		await page.getByLabel("App version").fill("1.2.1+9")
		await page.getByLabel("Device").fill("Pixel 8")
		await page.getByLabel("App size (MB)").fill("85")
		await page.getByLabel("Module increase (MB)").fill("12")
		await page.getByLabel("Downloaded assets (MB)").fill("30")
		await page.getByLabel("Local storage (MB)").fill("40")
		await page.getByLabel("Battery impact (%)").fill("4")
		await page.getByRole("button", { name: "Record Run" }).click()

		await expect(page.getByText(`Recorded the run tested on ${today}.`)).toBeVisible({
			timeout: 20_000,
		})
		// The table above the form now carries the run somebody just entered.
		await expect(page.getByRole("cell", { name: today }).first()).toBeVisible()

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/technical")
		await expect(page.getByRole("heading", { name: "Technical health" })).toBeVisible()
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

		await page.goto("/pisocamp/technical")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Technical health" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
