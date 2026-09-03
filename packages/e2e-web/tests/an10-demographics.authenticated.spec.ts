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
 * AN-10 in a real browser.
 *
 * The suppression rule and the consent scoping are asserted in the backend
 * suite; this proves the page says who is counted, marks what it withheld, and
 * refuses the whole thing to somebody without the dashboard permission.
 */
test.describe("AN-10 demographics", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("says who is counted and what was withheld", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/demographics")
		await expect(
			page.getByRole("heading", { name: "Demographics", level: 1 })
		).toBeVisible()
		await page.waitForLoadState("networkidle")

		await expect(page.getByText("Consent decides who is counted")).toBeVisible({
			timeout: 20_000,
		})
		await expect(page.getByText(/profiles consented to/)).toBeVisible()
		// Every dimension §4.2-I asks for.
		await expect(page.getByText("Age group", { exact: true })).toBeVisible()
		await expect(page.getByText("Gender", { exact: true })).toBeVisible()
		await expect(page.getByText("Region", { exact: true })).toBeVisible()
		await expect(page.getByText("City", { exact: true })).toBeVisible()
		await expect(page.getByText("Daily active users by gender").first()).toBeVisible()
		await expect(page.getByText("Session duration by gender").first()).toBeVisible()
		await expect(page.getByText("Day-7 retention by region").first()).toBeVisible()
		await expect(page.getByText("Churn by city").first()).toBeVisible()

		expectClean(observed)
	})

	test("refuses a range that ends before it starts", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/demographics")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("From", { exact: true }).fill("2027-01-01")
		await page.getByRole("button", { name: "Apply Range" }).click()

		await expect(page.locator("#demographics-range-error")).toHaveText(
			"The range must start on or before it ends."
		)

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/demographics")
		await expect(page.getByRole("heading", { name: "Demographics" })).toBeVisible()
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

		await page.goto("/pisocamp/demographics")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Demographics" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
