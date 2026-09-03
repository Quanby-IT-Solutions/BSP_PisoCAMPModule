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

/** A .docx and a .xlsx are zip packages; a PDF declares its version. */
const SIGNATURES = {
	xlsx: "PK",
	docx: "PK",
	pdf: "%PDF-",
} as const

/**
 * AN-9 in a real browser.
 *
 * The file contents are checked in the backend suite with a reader for each
 * format; this proves a person can actually take the file out of the page —
 * that the link downloads, the browser names the file, and the bytes that
 * arrive are the format they claim to be.
 */
test.describe("AN-9 report exports", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	async function generateActivityReport(page: Page) {
		await page.goto("/pisocamp/reports")
		await page.waitForLoadState("networkidle")
		await page.getByLabel("Report", { exact: true }).selectOption("activity")
		await page.getByRole("button", { name: "Generate Report" }).click()
		await expect(page.getByText(/covering \d{4}-\d{2}-\d{2} to/)).toBeVisible({
			timeout: 20_000,
		})
	}

	for (const [format, label] of [
		["xlsx", "Excel"],
		["docx", "Word"],
		["pdf", "PDF"],
	] as const) {
		test(`downloads the report as ${label}`, async ({ page }) => {
			const observed = observe(page)
			await signOutCompletely(page)
			await signInAs(page, "contentAdmin")
			await generateActivityReport(page)

			const [download] = await Promise.all([
				page.waitForEvent("download"),
				page
					.getByRole("link", { name: new RegExp(`as ${label}$`) })
					.first()
					.click(),
			])

			// The browser is told what to call the file, so it lands as a report
			// rather than as the run's identifier.
			expect(download.suggestedFilename()).toMatch(
				new RegExp(`^activity-\\d{4}-\\d{2}-\\d{2}-to-\\d{4}-\\d{2}-\\d{2}\\.${format}$`)
			)

			const path = join(mkdtempSync(join(tmpdir(), "an9-")), download.suggestedFilename())
			await download.saveAs(path)
			const bytes = readFileSync(path)
			expect(bytes.byteLength).toBeGreaterThan(1000)
			expect(bytes.toString("latin1").startsWith(SIGNATURES[format])).toBe(true)

			expectClean(observed)
		})
	}

	test("names each export link so a screen reader can tell them apart", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await generateActivityReport(page)

		const links = page.getByRole("link", { name: /^Export Activity for .* as / })
		// Three links called "Excel", "Word" and "PDF" would be three identical
		// links to somebody who cannot see the row they sit in.
		expect(await links.count()).toBeGreaterThanOrEqual(3)

		const excel = links.filter({ hasText: "Excel" }).first()
		await excel.focus()
		await expect(excel).toBeFocused()
		expect((await excel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the download to a user without reports.reports.export", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		// Straight at the endpoint, carrying this user's own session: the link is
		// not on their page at all, so the refusal has to come from the server
		// rather than from the UI.
		const response = await page.request.get(
			"http://localhost:3000/api/v1/admin/pisocamp/reports/runs/" +
				"00000000-0000-4000-8000-000000000000/export/pdf"
		)

		expect(response.status()).toBe(403)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
