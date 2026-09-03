import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { ADMIN_AUTH_FILE, AUTH_FILE } from "../constants"

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

const PUBLIC_CONFIG_URL = "http://localhost:3000/api/v1/pisocamp/config"

/**
 * SA-3 in a real browser.
 *
 * The registry's behaviour is reconciled in the backend suite; this proves the
 * screen an administrator uses, and that a saved change actually reaches the
 * unauthenticated configuration a device reads.
 */
test.describe("SA-3 module configuration", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: ADMIN_AUTH_FILE })

	async function saveLeaderboard(page: Page, enabled: boolean) {
		await page.goto("/pisocamp/config")
		await page.waitForLoadState("networkidle")
		const flag = page.getByLabel("Leaderboard enabled")
		await expect(flag).toBeVisible({ timeout: 20_000 })
		if ((await flag.isChecked()) !== enabled) await flag.setChecked(enabled)
		await page.getByRole("button", { name: "Save Configuration" }).click()
		await expect(page.getByText("Configuration saved.")).toBeVisible({ timeout: 20_000 })
	}

	test.afterAll(async ({ browser }) => {
		const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE })
		const page = await context.newPage()
		await saveLeaderboard(page, false)
		await context.close()
	})

	test("offers every administrator-managed setting with what it does", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/config")
		await expect(page.getByRole("heading", { name: "Module Configuration" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		for (const label of [
			"Session inactivity (minutes)",
			"Exit advisory interval (hours)",
			"Churn inactivity (days)",
			"Trivia repeat window (days)",
			"Leaderboard enabled",
			"Recognition confidence threshold",
			"Small-group suppression minimum",
			"Age groups",
			"Active privacy notice version",
		]) {
			await expect(page.getByLabel(label, { exact: true })).toBeVisible()
		}
		// The key actions are a set, so each one is its own control.
		await expect(page.getByLabel("content_view", { exact: true })).toBeVisible()

		expectClean(observed)
	})

	test("saves a change and serves it in the public configuration", async ({ page }) => {
		const observed = observe(page)

		const before = await page.request.get(PUBLIC_CONFIG_URL)
		expect((await before.json()).leaderboard_enabled).toBe(false)

		await saveLeaderboard(page, true)

		const after = await page.request.get(PUBLIC_CONFIG_URL)
		const config = await after.json()
		// A device reads this without a session, so what an administrator turned
		// on has to be visible here or the setting does nothing.
		expect(config.leaderboard_enabled).toBe(true)
		expect(config).toHaveProperty("trivia_repeat_days")
		expect(config).toHaveProperty("recognition_confidence_threshold")
		// The analytics settings are the server's business.
		expect(config).not.toHaveProperty("suppression_minimum")
		expect(config).not.toHaveProperty("key_action_events")

		expectClean(observed)
	})

	test("refuses a value the contract would reject, and says why", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/config")
		await page.waitForLoadState("networkidle")

		const groups = page.getByLabel("Age groups", { exact: true })
		await groups.fill("young, old")
		await page.getByRole("button", { name: "Save Configuration" }).click()

		await expect(page.locator("#age-group-buckets-error")).toBeVisible()
		await expect(groups).toBeFocused()

		expectClean(observed)
	})

	test("refuses a notice version that is not stored", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/config")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Active privacy notice version", { exact: true }).fill("not-a-version")
		await page.getByRole("button", { name: "Save Configuration" }).click()

		// Consent reads this key and refuses to serve when it names a notice that
		// is not there, so the refusal has to happen here.
		await expect(page.getByText("Could not save configuration")).toBeVisible({
			timeout: 20_000,
		})
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})

	test("stays readable and operable by keyboard at 320 px", async ({ browser }) => {
		const context = await browser.newContext({
			storageState: ADMIN_AUTH_FILE,
			viewport: { width: 320, height: 720 },
		})
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/config")
		await expect(page.getByRole("heading", { name: "Module Configuration" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const groups = page.getByLabel("Age groups", { exact: true })
		await groups.focus()
		await expect(groups).toBeFocused()
		expect((await groups.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
		await context.close()
	})

	test("refuses the screen to a user without admin.config.manage", async ({ browser }) => {
		const context = await browser.newContext({ storageState: AUTH_FILE })
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/config")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Module Configuration" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
		await context.close()
	})
})
