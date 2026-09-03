import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { ADMIN_AUTH_FILE, AUTH_FILE } from "../constants"
import { ACCOUNTS } from "../fixtures"

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

const SUBJECT = ACCOUNTS.contentEditor
const ROLE = "Reports & Analytics User"

async function openRoles(page: Page) {
	await page.goto("/pisocamp/accounts")
	await page.waitForLoadState("networkidle")
	await page.getByLabel("Search").fill(SUBJECT.email)
	await page.getByRole("button", { name: "Search" }).click()
	await page.waitForLoadState("networkidle")

	const row = page.getByRole("row", { name: new RegExp(SUBJECT.email) })
	await expect(row).toBeVisible({ timeout: 20_000 })
	await row.getByRole("button", { name: "Edit Roles" }).click()
	return { row, dialog: page.getByRole("dialog") }
}

/**
 * SA-2 in a real browser.
 *
 * The grant and revoke themselves are reconciled in the backend suite; this
 * proves the screen an administrator actually uses — that the permission keys
 * are visible beside each role, and that a change round-trips.
 */
test.describe("SA-2 role assignment", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: ADMIN_AUTH_FILE })

	test.afterAll(async ({ browser }) => {
		// Leave the subject as this spec found them.
		const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE })
		const page = await context.newPage()
		const { dialog } = await openRoles(page)
		const checkbox = dialog.getByRole("checkbox", { name: new RegExp(ROLE) })
		if (await checkbox.isChecked()) {
			await checkbox.uncheck()
			await dialog.getByRole("button", { name: "Save Roles" }).click()
			await expect(dialog).toBeHidden({ timeout: 20_000 })
		}
		await context.close()
	})

	test("shows every role with the permission keys it carries", async ({ page }) => {
		const observed = observe(page)
		const { dialog } = await openRoles(page)

		await expect(dialog).toBeVisible()
		const option = dialog.getByRole("checkbox", { name: new RegExp(ROLE) })
		await expect(option).toBeVisible()
		// The keys are shown beside the role, read-only: an assignment whose
		// consequences nobody can see is not one anybody can review.
		await expect(dialog.getByText("reports.dashboards.view", { exact: false }).first()).toBeVisible()

		expectClean(observed)
	})

	test("assigns a role and shows it against the account", async ({ page }) => {
		const observed = observe(page)
		const { row, dialog } = await openRoles(page)

		await dialog.getByRole("checkbox", { name: new RegExp(ROLE) }).check()
		await dialog.getByRole("button", { name: "Save Roles" }).click()

		await expect(dialog).toBeHidden({ timeout: 20_000 })
		await expect(row.getByText(ROLE)).toBeVisible({ timeout: 20_000 })

		expectClean(observed)
	})

	test("revokes the role again", async ({ page }) => {
		const observed = observe(page)
		const { row, dialog } = await openRoles(page)

		await dialog.getByRole("checkbox", { name: new RegExp(ROLE) }).uncheck()
		await dialog.getByRole("button", { name: "Save Roles" }).click()

		await expect(dialog).toBeHidden({ timeout: 20_000 })
		await expect(row.getByText(ROLE)).toHaveCount(0)

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ browser }) => {
		const context = await browser.newContext({
			storageState: ADMIN_AUTH_FILE,
			viewport: { width: 320, height: 720 },
		})
		const page = await context.newPage()
		const observed = observe(page)
		const { dialog } = await openRoles(page)

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const option = dialog.getByRole("checkbox", { name: new RegExp(ROLE) })
		await option.focus()
		await expect(option).toBeFocused()

		expectClean(observed)
		await context.close()
	})

	test("refuses role management to a user without admin.roles.assign", async ({ browser }) => {
		const context = await browser.newContext({ storageState: AUTH_FILE })
		const page = await context.newPage()
		const observed = observe(page)

		const response = await page.request.put(
			"http://localhost:3000/api/v1/admin/pisocamp/users/seed-user-alex/roles",
			{ data: { userId: "seed-user-alex", roles: [] } }
		)

		expect(response.status()).toBe(403)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
		await context.close()
	})
})
