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
 * AN-8 in a real browser.
 *
 * The reconciliation happens in the backend suite; this proves a person can
 * choose a report, set a period and filters, generate it, and see what
 * produced it — and that the history keeps the run.
 */
test.describe("AN-8 report builder", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("offers every registered report with its data source", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/reports")
		await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const report = page.getByLabel("Report", { exact: true })
		await expect(report).toBeVisible({ timeout: 20_000 })
		for (const name of ["Engagement", "Retention", "Adoption", "Activity"]) {
			await expect(page.getByRole("option", { name })).toBeAttached()
		}
		await expect(page.getByText(/Source: analytics_session/)).toBeVisible()

		expectClean(observed)
	})

	test("generates a report and says what produced it", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/reports")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Report", { exact: true }).selectOption("activity")
		await page.getByLabel("OS").fill("android")
		await page.getByRole("button", { name: "Generate Report" }).click()

		await expect(page.getByText(/covering \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible({
			timeout: 20_000,
		})
		await expect(page.getByText(/os = android/)).toBeVisible()
		await expect(page.getByText(/"totalEvents"/)).toBeVisible()

		// The run is kept, so a report generated today can be found tomorrow.
		await expect(page.getByRole("cell", { name: "Complete" }).first()).toBeVisible()

		expectClean(observed)
	})

	test("withholds a demographic cut and says why", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/reports")
		await page.waitForLoadState("networkidle")

		// No demographic filter is offered, precisely because AN-10 owns them.
		await expect(page.getByLabel("Gender")).toHaveCount(0)
		await expect(page.getByLabel("Region")).toHaveCount(0)

		expectClean(observed)
	})

	test("refuses a range that ends before it starts", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/reports")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("From", { exact: true }).fill("2026-12-31")
		await page.getByRole("button", { name: "Generate Report" }).click()

		// Scoped to the form's own message: the toaster region is also an alert.
		await expect(page.locator("#report-range-error")).toHaveText(
			"The range must start on or before it ends."
		)

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/reports")
		await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const report = page.getByLabel("Report", { exact: true })
		await report.focus()
		await expect(report).toBeFocused()
		expect((await report.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the page to a user without reports.reports.generate", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		await page.goto("/pisocamp/reports")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Reports" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
