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
 * AN-2 in a real browser.
 *
 * The reconciliation happens in the backend suite; this proves the dashboard
 * renders the figures, answers a changed range, and stays usable at 320 px.
 */
test.describe("AN-2 engagement dashboard", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("shows the engagement figures for the default range", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/engagement")
		await expect(page.getByRole("heading", { name: "Engagement", level: 1 })).toBeVisible()
		await page.waitForLoadState("networkidle")

		await expect(page.getByText("DAU", { exact: true })).toBeVisible({ timeout: 20_000 })
		await expect(page.getByText("MAU", { exact: true })).toBeVisible()
		await expect(page.getByText("Sessions per user")).toBeVisible()
		await expect(page.getByText(/A session gap of \d+ minutes ends a session/)).toBeVisible()

		expectClean(observed)
	})

	test("refuses a range that ends before it starts", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/engagement")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("From", { exact: true }).fill("2027-01-01")
		await page.getByRole("button", { name: "Apply Range" }).click()

		await expect(
			page.getByText("The range must start on or before it ends.")
		).toBeVisible()

		expectClean(observed)
	})

	test("answers a changed range", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/engagement")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("From", { exact: true }).fill("2026-08-10")
		await page.getByLabel("To", { exact: true }).fill("2026-08-11")
		await page.getByRole("button", { name: "Apply Range" }).click()

		// A row per day in the range, whether or not anybody was active.
		await expect(page.getByRole("cell", { name: "2026-08-10" })).toBeVisible({
			timeout: 20_000,
		})
		await expect(page.getByRole("cell", { name: "2026-08-11" })).toBeVisible()

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/engagement")
		await expect(page.getByRole("heading", { name: "Engagement" })).toBeVisible()
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

	test("refuses the dashboard to a user without reports.dashboards.view", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		await page.goto("/pisocamp/engagement")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Engagement" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
