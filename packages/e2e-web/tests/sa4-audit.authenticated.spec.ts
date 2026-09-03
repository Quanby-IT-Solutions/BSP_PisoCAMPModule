import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

/**
 * SA-4 in a real browser.
 *
 * The filters are reconciled in the backend suite; this proves the reading an
 * administrator actually does, and that exporting the trail goes out through
 * AN-9 and lands back in the trail as an entry of its own.
 */
test.describe("SA-4 audit log viewer", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: ADMIN_AUTH_FILE })

	test("shows who did what, when, and what it was before", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/audit")
		await expect(page.getByRole("heading", { name: "Audit Log", level: 1 })).toBeVisible()
		await page.waitForLoadState("networkidle")

		await expect(page.getByRole("columnheader", { name: "Actor" })).toBeVisible({
			timeout: 20_000,
		})
		for (const column of ["When", "Action", "Target", "Before", "After"]) {
			await expect(page.getByRole("columnheader", { name: column })).toBeVisible()
		}
		// Earlier tickets have written plenty of entries by now.
		await expect(page.getByRole("row")).not.toHaveCount(1)

		expectClean(observed)
	})

	test("narrows to one action, and back again", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/audit")
		await page.waitForLoadState("networkidle")

		// A permission denial: the browser specs before this one produced plenty,
		// and the ticket names denials as entries the viewer must show.
		await page.getByLabel("Action").fill("permission_denied")
		await page.getByRole("button", { name: "Apply Filters" }).click()

		// Wait for the answer rather than for the network to fall quiet: the row
		// appears when React re-renders, which is after the request settles.
		const firstRow = page.getByRole("row").nth(1)
		await expect(firstRow).toBeVisible({ timeout: 20_000 })
		await expect(firstRow.getByText("permission_denied")).toBeVisible()
		await expect(firstRow.getByText("Denied")).toBeVisible()

		expectClean(observed)
	})

	test("says plainly when a filter matches nothing", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/audit")
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Action").fill("never.happened")
		await page.getByRole("button", { name: "Apply Filters" }).click()

		await expect(page.getByText("No entry matches those filters.")).toBeVisible({
			timeout: 20_000,
		})

		expectClean(observed)
	})

	test("exports the trail through AN-9, and records the export in it", async ({ page }) => {
		const observed = observe(page)

		await page.goto("/pisocamp/audit")
		await page.waitForLoadState("networkidle")

		await page.getByRole("button", { name: "Prepare Export" }).click()
		const link = page.getByRole("link", { name: /as Excel$/ })
		await expect(link).toBeVisible({ timeout: 20_000 })

		const [download] = await Promise.all([page.waitForEvent("download"), link.click()])
		const path = join(mkdtempSync(join(tmpdir(), "sa4-")), download.suggestedFilename())
		await download.saveAs(path)
		const bytes = readFileSync(path)
		expect(download.suggestedFilename()).toMatch(/^audit-.*\.xlsx$/)
		expect(bytes.toString("latin1").startsWith("PK")).toBe(true)

		// The export is itself an entry: AN-9 records every file that leaves.
		await page.reload()
		await page.getByLabel("Action").fill("report.export")
		await page.getByRole("button", { name: "Apply Filters" }).click()
		await page.waitForLoadState("networkidle")
		await expect(page.getByRole("row").nth(1).getByText("report.export")).toBeVisible({
			timeout: 20_000,
		})

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ browser }) => {
		const context = await browser.newContext({
			storageState: ADMIN_AUTH_FILE,
			viewport: { width: 320, height: 720 },
		})
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/audit")
		await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const action = page.getByLabel("Action")
		await action.focus()
		await expect(action).toBeFocused()
		expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
		await context.close()
	})

	test("refuses the viewer to a user without admin.audit.view", async ({ browser }) => {
		const context = await browser.newContext({ storageState: AUTH_FILE })
		const page = await context.newPage()
		const observed = observe(page)

		await page.goto("/pisocamp/audit")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Audit Log" })).toHaveCount(0)

		const response = await page.request.get(
			"http://localhost:3000/api/v1/admin/pisocamp/audit?limit=10"
		)
		expect(response.status()).toBe(403)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
		await context.close()
	})
})
