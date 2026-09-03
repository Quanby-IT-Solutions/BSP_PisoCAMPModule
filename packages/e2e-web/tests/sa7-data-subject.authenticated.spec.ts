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

const EXPORT_URL = "http://localhost:3000/api/v1/pisocamp/me/data-export"

/**
 * SA-7 in a real browser.
 *
 * The deletion itself is reconciled in the backend suite against a database it
 * owns; deleting a seeded account here would take the rest of the suite's
 * fixtures with it. What this proves is the screen and the export: that a
 * person can get their own copy, that the deletion is confirmed rather than
 * done on one click, and that it is refused to somebody without the permission.
 */
test.describe("SA-7 data subject rights", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: AUTH_FILE })

	test("gives a signed-in person their own data, documented", async ({ page }) => {
		const observed = observe(page)
		await page.goto("/dashboard")

		const response = await page.request.get(EXPORT_URL)

		expect(response.status()).toBe(200)
		const exported = await response.json()
		// It is their data: no administrator, no permission, just a session.
		expect(exported.account).toHaveProperty("email")
		expect(exported).toHaveProperty("consents")
		expect(exported).toHaveProperty("surveyResponses")
		// Every section says what it is, including why analytics are absent.
		expect(exported.documentation.analytics).toContain("device pseudonym")
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})

	test("asks for the approval reference before deleting anything", async ({ browser }) => {
		const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE })
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/accounts")
		await page.waitForLoadState("networkidle")

		const row = page.getByRole("row").nth(1)
		await row.getByRole("button", { name: "Delete Data" }).click()

		const dialog = page.getByRole("dialog")
		await expect(dialog).toBeVisible()
		// A destructive act with no undo says what it keeps as well as what it
		// removes, and will not proceed without the approval it was done under.
		await expect(dialog.getByText(/consent records are kept/i)).toBeVisible()
		await expect(dialog.getByText(/cannot be undone/i)).toBeVisible()

		await dialog.getByRole("button", { name: "Delete Data" }).click()
		await expect(page.locator("#deletion-approval-error")).toBeVisible()

		expectClean(observed)
		await context.close()
	})

	test("refuses deletion to a user without admin.accounts.manage", async ({ page }) => {
		const observed = observe(page)
		await page.goto("/dashboard")

		const response = await page.request.post(
			"http://localhost:3000/api/v1/admin/pisocamp/accounts/seed-user-alex/data-deletion",
			{ data: { accountId: "seed-user-alex", approvalReference: "DSR-TEST" } }
		)

		expect(response.status()).toBe(403)
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
		await page.waitForLoadState("networkidle")
		await page.getByRole("row").nth(1).getByRole("button", { name: "Delete Data" }).click()

		const reference = page.getByLabel("BSP approval reference")
		await reference.focus()
		await expect(reference).toBeFocused()
		// Polled: the dialog scales in, so a box measured mid-animation is
		// smaller than the control a finger will actually meet.
		await expect
			.poll(async () => (await reference.boundingBox())?.height ?? 0)
			.toBeGreaterThanOrEqual(44)

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		expectClean(observed)
		await context.close()
	})
})
