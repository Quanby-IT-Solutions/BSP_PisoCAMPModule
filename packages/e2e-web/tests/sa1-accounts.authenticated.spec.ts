import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { ADMIN_AUTH_FILE, AUTH_FILE } from "../constants"
import { ACCOUNTS, signInAs, signOutCompletely } from "../fixtures"

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
 * The account this spec locks out and puts back.
 *
 * Deliberately not `userA` or `admin`: those two are what the shared sign-in
 * setup uses, so deactivating either would break every other spec's stored
 * session rather than only this one's subject.
 */
const SUBJECT = ACCOUNTS.contentEditor

/** Restore the subject, so a failed run does not leave them locked out. */
async function reactivate(page: Page) {
	await page.goto("/pisocamp/accounts")
	await page.getByLabel("Search").fill(SUBJECT.email)
	await page.getByRole("button", { name: "Search" }).click()
	await page.waitForLoadState("networkidle")

	const row = page.getByRole("row", { name: new RegExp(SUBJECT.email) })
	const reactivateButton = row.getByRole("button", { name: "Reactivate" })
	if ((await reactivateButton.count()) > 0) {
		await reactivateButton.click()
		await expect(row.getByText("Active")).toBeVisible({ timeout: 20_000 })
	}
}

/**
 * SA-1 in a real browser.
 *
 * The service behaviour is reconciled in the backend suite; this proves the
 * loop a person actually runs: find somebody, deactivate them with a reason,
 * watch them be refused at sign-in, and put them back.
 */
test.describe("SA-1 account activation and deactivation", () => {
	test.describe.configure({ mode: "serial" })
	// The admin session the setup project already established, rather than a
	// sign-in per test: Better Auth rate-limits `/sign-in/email` per path, and
	// this spec needs its two *subject* sign-ins to be the ones that get through.
	test.use({ storageState: ADMIN_AUTH_FILE })

	test.afterAll(async ({ browser }) => {
		const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE })
		const page = await context.newPage()
		await reactivate(page)
		await context.close()
	})

	test("lists accounts and finds one by address", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/accounts")
		await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible()
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Search").fill(SUBJECT.email)
		await page.getByRole("button", { name: "Search" }).click()
		await page.waitForLoadState("networkidle")

		const row = page.getByRole("row", { name: new RegExp(SUBJECT.email) })
		await expect(row).toBeVisible({ timeout: 20_000 })
		await expect(row.getByText("Active")).toBeVisible()

		expectClean(observed)
	})

	test("asks for a reason before deactivating, then records it", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/accounts")
		await page.getByLabel("Search").fill(SUBJECT.email)
		await page.getByRole("button", { name: "Search" }).click()
		await page.waitForLoadState("networkidle")

		const row = page.getByRole("row", { name: new RegExp(SUBJECT.email) })
		await row.getByRole("button", { name: "Deactivate" }).click()

		const dialog = page.getByRole("dialog")
		await expect(dialog).toBeVisible()
		// A destructive action confirms first, and will not proceed on nothing.
		await dialog.getByRole("button", { name: "Deactivate Account" }).click()
		await expect(page.locator("#deactivate-reason-error")).toHaveText(
			"Give a reason, so the change can be explained later."
		)

		await dialog.getByLabel("Reason").fill("SA-1 browser check")
		await dialog.getByRole("button", { name: "Deactivate Account" }).click()

		await expect(row.getByText("Deactivated")).toBeVisible({ timeout: 20_000 })
		await expect(row.getByText("SA-1 browser check")).toBeVisible()

		expectClean(observed)
	})

	test("refuses the deactivated account at sign-in, with a message it can act on", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)

		await page.goto("/login")
		await page.getByLabel("Email", { exact: true }).fill(SUBJECT.email)
		await page.getByLabel("Password", { exact: true }).fill(SUBJECT.password)
		await page.getByRole("button", { name: "Login", exact: true }).click()

		// Not "invalid credentials": that would send them to reset a password
		// that was never the problem.
		await expect(page.getByText(/deactivated/i).first()).toBeVisible({ timeout: 20_000 })
		await expect(page).toHaveURL(/\/login/)

		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})

	test("restores access when the account is reactivated", async ({ page, browser }) => {
		const observed = observe(page)
		const admin = await browser.newContext({ storageState: ADMIN_AUTH_FILE })
		const adminPage = await admin.newPage()
		await reactivate(adminPage)
		await admin.close()

		await signOutCompletely(page)
		// Through the shared fixture, which retries Better Auth's per-path 429:
		// this spec's own refused attempt above already spent one of the few
		// sign-ins that window allows, and a rate limit is not a lock-out.
		await signInAs(page, "contentEditor")

		await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})

	test("stays readable and operable by keyboard at 320 px", async ({ browser }) => {
		const context = await browser.newContext({
			storageState: ADMIN_AUTH_FILE,
			viewport: { width: 320, height: 720 },
		})
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/accounts")
		await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const search = page.getByLabel("Search")
		await search.focus()
		await expect(search).toBeFocused()
		expect((await search.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
		await context.close()
	})

	test("refuses the page to a user without admin.accounts.manage", async ({ browser }) => {
		// The ordinary user's session, established once by the setup project.
		const context = await browser.newContext({ storageState: AUTH_FILE })
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/accounts")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Accounts" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
		await context.close()
	})
})
