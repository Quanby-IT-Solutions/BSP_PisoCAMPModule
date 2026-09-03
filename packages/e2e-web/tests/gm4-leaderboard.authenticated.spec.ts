import {
	expect,
	test,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { ADMIN_AUTH_FILE } from "../constants"

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

const LEADERBOARD_URL = "http://localhost:3000/api/v1/pisocamp/leaderboard?period=weekly"
const PUBLIC_CONFIG_URL = "http://localhost:3000/api/v1/pisocamp/config"

/**
 * GM-4 in a real browser.
 *
 * The board itself is a mobile screen, reconciled in the Flutter and backend
 * suites. What a browser can prove is the half that lives here: the flag an
 * administrator turns, and that turning it actually closes the API rather than
 * only hiding a button.
 */
test.describe("GM-4 leaderboard flag", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: ADMIN_AUTH_FILE })

	async function setLeaderboard(page: Page, enabled: boolean) {
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
		await setLeaderboard(page, false)
		await context.close()
	})

	test("closes the leaderboard API when the flag is off", async ({ page }) => {
		const observed = observe(page)
		await setLeaderboard(page, false)

		const response = await page.request.get(LEADERBOARD_URL)

		// A disabled feature that still answered would be a feature, and the
		// flag would be decoration.
		expect(response.status()).toBe(404)
		const config = await (await page.request.get(PUBLIC_CONFIG_URL)).json()
		expect(config.leaderboard_enabled).toBe(false)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})

	test("opens it again, by alias and nothing else", async ({ page }) => {
		const observed = observe(page)
		await setLeaderboard(page, true)

		const response = await page.request.get(LEADERBOARD_URL)

		expect(response.status()).toBe(200)
		const board = await response.json()
		expect(board).toMatchObject({ period: "weekly", timezone: "Asia/Manila" })
		// Whatever is on the board, it is aliases: no address, no real name.
		const shown = JSON.stringify(board)
		expect(shown).not.toContain("@")
		for (const standing of board.top) {
			expect(standing.alias.length).toBeGreaterThan(0)
		}

		const config = await (await page.request.get(PUBLIC_CONFIG_URL)).json()
		// The device learns the flag from the same public configuration, so the
		// entry point disappears without the app being rebuilt.
		expect(config.leaderboard_enabled).toBe(true)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
