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

async function chooseSelect(page: Page, name: string, option: string, index = 0) {
	await page.getByRole("combobox", { name }).nth(index).click()
	await page.getByRole("option", { name: option, exact: true }).click()
}

async function openArForm(page: Page) {
	await page.goto("/pisocamp/content/new")
	await expect(page.getByRole("combobox", { name: "Content type" })).toBeVisible()
	await page.waitForLoadState("networkidle")
	await chooseSelect(page, "Content type", "AR experience")
}

/**
 * AR-2 in a real browser.
 *
 * The jsdom suite proves the form's rules; this proves a person can actually
 * define an experience — the controls are on the rendered page, the console and
 * the network stay clean, and the screen is operable at 320 px.
 */
test.describe("AR-2 authoring an AR experience in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("creates an experience with its denomination and device requirements", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openArForm(page)

		const suffix = crypto.randomUUID().slice(0, 8)
		await page.getByLabel("Title", { exact: true }).fill(`AR-2 experience ${suffix}`)
		await page
			.getByLabel("Summary", { exact: true })
			.fill("Place the 20-piso coin on any surface.")
		await page.getByLabel("Body", { exact: true }).fill("Point the camera at a flat surface.")
		await chooseSelect(page, "Currency series", "New Generation Currency Coin Series")
		await chooseSelect(page, "Denomination", "PHP 20")
		await page.getByLabel("Minimum Android SDK (ARCore)").fill("26")
		await page.getByLabel("Minimum iOS version (ARKit)").fill("13.0")
		await page.getByLabel("Animation length (milliseconds)").fill("12000")

		await page.getByRole("button", { name: /save draft/i }).click()

		await expect(page).toHaveURL(/\/pisocamp\/content$/)
		await expect(
			page.getByRole("link", { name: `Edit AR-2 experience ${suffix}` })
		).toBeVisible({ timeout: 20_000 })

		expectClean(observed)
	})

	test("says which assets an experience needs before review", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openArForm(page)

		// The rule is stated where the editor is, not only when the submission
		// is refused.
		await expect(
			page.getByText(/The 3D model, its animation and its narration are attached as assets/)
		).toBeVisible()

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openArForm(page)

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const android = page.getByLabel("Minimum Android SDK (ARCore)")
		await android.focus()
		await expect(android).toBeFocused()
		expect((await android.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})
})
