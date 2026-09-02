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
 * EV-4's interval in a real browser, and the public configuration that carries
 * it to a device.
 */
test.describe("EV-4 exit advisory interval", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("saves the interval and serves it in the public configuration", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/config")
		await expect(page.getByRole("heading", { name: "Module Configuration" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const interval = page.getByLabel("Exit advisory interval (hours)")
		await interval.fill("6")
		await page.getByRole("button", { name: "Save Configuration" }).click()
		await expect(page.getByText("Configuration saved.")).toBeVisible({ timeout: 20_000 })

		// The device reads this without a session, so that is how it is checked.
		const config = await page.request.get(
			`${process.env.EV4_E2E_API_ORIGIN ?? "http://localhost:3000"}/api/v1/pisocamp/config`
		)
		expect(config.status()).toBe(200)
		expect(await config.json()).toMatchObject({ exit_advisory_interval_hours: 6 })

		// Put it back, so the next run starts where this one did.
		await interval.fill("24")
		await page.getByRole("button", { name: "Save Configuration" }).click()
		await expect(page.getByText("Configuration saved.")).toBeVisible({ timeout: 20_000 })

		expectClean(observed)
	})

	test("refuses an interval outside the range and says why", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/config")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Exit advisory interval (hours)").fill("0")
		await page.getByRole("button", { name: "Save Configuration" }).click()

		await expect(
			page.getByText("Enter a whole number of hours between 1 and 8,760.")
		).toBeVisible()

		expectClean(observed)
	})

	test("saves the AN-4 churn period from the same form", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/config")
		await page.waitForLoadState("networkidle")

		const churn = page.getByLabel(/churn inactivity/i)
		await expect(churn).toBeVisible({ timeout: 20_000 })
		await churn.fill("45")
		await page.getByRole("button", { name: /save configuration/i }).click()

		await expect(page.getByText("Configuration saved.")).toBeVisible()
		await page.reload()
		await page.waitForLoadState("networkidle")
		await expect(page.getByLabel(/churn inactivity/i)).toHaveValue("45")

		// Put it back, so the next run starts where this one did.
		await page.getByLabel(/churn inactivity/i).fill("30")
		await page.getByRole("button", { name: /save configuration/i }).click()
		await expect(page.getByText("Configuration saved.")).toBeVisible()

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/config")
		await expect(page.getByRole("heading", { name: "Module Configuration" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const interval = page.getByLabel("Exit advisory interval (hours)")
		await interval.focus()
		await expect(interval).toBeFocused()

		expectClean(observed)
	})
})
