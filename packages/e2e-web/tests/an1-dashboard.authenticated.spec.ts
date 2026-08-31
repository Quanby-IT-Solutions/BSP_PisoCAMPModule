import path from "node:path"
import { expect, test, type Page, type Request } from "@playwright/test"

import { ADMIN_AUTH_FILE } from "../constants"

const analyticsPath = "/api/v1/admin/pisocamp/analytics/module-entry-today"
const artifactDir = process.env.AN1_ARTIFACT_DIR

async function captureAcceptanceScreenshot(page: Page, name: string) {
	if (!artifactDir) return
	await page.screenshot({ path: path.join(artifactDir, name), fullPage: true })
}

function isAnalyticsSummary(request: Request) {
	return request.method() === "GET" && new URL(request.url()).pathname === analyticsPath
}

function collectRuntimeFailures(page: Page) {
	const consoleErrors: string[] = []
	const pageErrors: string[] = []
	const failedRequests: string[] = []

	page.on("console", message => {
		if (message.type() === "error" || message.type() === "warning") {
			consoleErrors.push(`[${message.type()}] ${message.text()}`)
		}
	})
	page.on("pageerror", error => pageErrors.push(error.message))
	page.on("requestfailed", request => {
		if (request.failure()?.errorText === "net::ERR_ABORTED") return
		failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText}`)
	})

	return { consoleErrors, pageErrors, failedRequests }
}

async function assertCleanRuntime(failures: ReturnType<typeof collectRuntimeFailures>) {
	expect(failures.consoleErrors, `console: ${failures.consoleErrors.join(" | ")}`).toEqual([])
	expect(failures.pageErrors, `page errors: ${failures.pageErrors.join(" | ")}`).toEqual([])
	expect(
		failures.failedRequests,
		`failed requests: ${failures.failedRequests.join(" | ")}`
	).toEqual([])
}

test.describe("AN-1 permitted analytics dashboard", () => {
	test.use({ storageState: ADMIN_AUTH_FILE })

	test("requests one aggregate, exposes accessible semantics, and reflows at 320px/200% text", async ({
		page,
	}) => {
		const failures = collectRuntimeFailures(page)
		const analyticsRequests: Request[] = []
		page.on("request", request => {
			if (isAnalyticsSummary(request)) analyticsRequests.push(request)
		})
		await page.setViewportSize({ width: 320, height: 800 })

		const responsePromise = page.waitForResponse(
			response => isAnalyticsSummary(response.request()) && response.status() === 200
		)
		await page.goto("/dashboard")
		const response = await responsePromise

		await expect(page).toHaveURL(/\/dashboard/)
		const tile = page.getByRole("region", { name: "Module entries today" })
		await expect(tile).toBeVisible()
		await expect(tile.getByRole("heading", { name: "Module entries today" })).toBeVisible()
		await expect(tile.locator('[aria-live="polite"]')).toBeVisible()
		await expect(tile).toContainText("Asia/Manila")
		expect(analyticsRequests).toHaveLength(1)

		const body = (await response.json()) as Record<string, unknown>
		expect(Object.keys(body).toSorted()).toEqual(
			["date", "moduleEntryCount", "timezone"].toSorted()
		)
		expect(JSON.stringify(body)).not.toMatch(/eventId|sessionId|subjectPseudoId|properties/i)

		await page.evaluate(() => {
			document.documentElement.style.fontSize = "200%"
		})

		const overflow = await page.evaluate(() => ({
			documentWidth: document.documentElement.scrollWidth,
			viewportWidth: document.documentElement.clientWidth,
			offenders: Array.from(document.body.querySelectorAll<HTMLElement>("*"))
				.map(element => {
					const rect = element.getBoundingClientRect()
					return {
						tag: element.tagName.toLowerCase(),
						role: element.getAttribute("role"),
						label: element.getAttribute("aria-label"),
						className: element.className.toString(),
						left: Math.round(rect.left),
						right: Math.round(rect.right),
						width: Math.round(rect.width),
					}
				})
				.filter(element => element.right > document.documentElement.clientWidth + 1),
		}))
		expect(overflow, JSON.stringify(overflow.offenders, null, 2)).toMatchObject({
			documentWidth: overflow.viewportWidth,
		})

		const roleBadges = page.locator('header [data-slot="badge"]')
		expect(await roleBadges.count()).toBeGreaterThan(0)
		const clippedRoleBadges = await roleBadges.evaluateAll(badges =>
			badges
				.map(badge => ({
					label: badge.textContent?.trim(),
					clientHeight: badge.clientHeight,
					scrollHeight: badge.scrollHeight,
					clientWidth: badge.clientWidth,
					scrollWidth: badge.scrollWidth,
				}))
				.filter(
					badge => badge.scrollHeight > badge.clientHeight || badge.scrollWidth > badge.clientWidth
				)
		)
		expect(clippedRoleBadges).toEqual([])

		await page.keyboard.press("Tab")
		expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)
		await assertCleanRuntime(failures)
		await captureAcceptanceScreenshot(page, "task-9-dashboard-authorized-live.png")
	})

	test("renders an accessible numeric zero without exposing raw event data", async ({ page }) => {
		const failures = collectRuntimeFailures(page)
		await page.route(`**${analyticsPath}`, route =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					date: "2026-08-31",
					timezone: "Asia/Manila",
					moduleEntryCount: 0,
				}),
			})
		)

		await page.goto("/dashboard")
		const tile = page.getByRole("region", { name: "Module entries today" })
		await expect(tile.getByLabel("0 module entries today")).toHaveText("0")
		await expect(tile.getByRole("time")).toHaveAttribute("datetime", "2026-08-31")
		expect(await tile.innerText()).not.toMatch(/eventId|sessionId|subjectPseudoId|properties/i)
		await assertCleanRuntime(failures)
		await captureAcceptanceScreenshot(page, "task-9-dashboard-authorized-zero.png")
	})

	test("contains an upstream error and recovers through the labelled retry", async ({ page }) => {
		const failures = collectRuntimeFailures(page)
		const rawSentinel = "eventId=private sessionId=private pseudonym=private properties=private"
		let attempts = 0
		let releaseFirstRequest!: () => void
		let markFirstRequestStarted!: () => void
		const firstRequestStarted = new Promise<void>(resolve => {
			markFirstRequestStarted = resolve
		})
		const firstRequestRelease = new Promise<void>(resolve => {
			releaseFirstRequest = resolve
		})
		await page.route(`**${analyticsPath}`, async route => {
			attempts += 1
			if (attempts === 1) {
				markFirstRequestStarted()
				await firstRequestRelease
			}
			if (attempts <= 4) {
				await route.fulfill({ status: 500, contentType: "text/plain", body: rawSentinel })
				return
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					date: "2026-08-31",
					timezone: "Asia/Manila",
					moduleEntryCount: 7,
				}),
			})
		})

		const navigation = page.goto("/dashboard")
		await firstRequestStarted
		const tile = page.getByRole("region", { name: "Module entries today" })
		await expect(tile.getByRole("status")).toContainText("Loading module entries today")
		await captureAcceptanceScreenshot(page, "task-9-dashboard-authorized-loading.png")
		releaseFirstRequest()
		await navigation
		await expect(tile.getByRole("alert")).toContainText("Could not load module entries", {
			timeout: 20_000,
		})
		await expect(page.getByText(rawSentinel)).toHaveCount(0)
		expect(JSON.stringify(failures)).not.toContain(rawSentinel)

		// The mocked upstream failures are expected to emit generic 500 resource messages.
		// Start the clean-runtime window after the error state is fully observed.
		failures.consoleErrors.length = 0

		const retry = tile.getByRole("button", { name: "Retry module entries" })
		await retry.focus()
		await expect(retry).toBeFocused()
		await retry.press("Enter")

		await expect(tile.getByLabel("7 module entries today")).toBeVisible()
		expect(attempts).toBe(5)
		expect(await page.locator("body").innerText()).not.toContain(rawSentinel)
		expect(JSON.stringify(failures)).not.toContain(rawSentinel)
		await assertCleanRuntime(failures)
		await captureAcceptanceScreenshot(page, "task-9-dashboard-authorized-recovered.png")
	})
})

test("AN-1 denied user mounts no tile and sends no protected analytics request", async ({
	page,
}) => {
	const failures = collectRuntimeFailures(page)
	const analyticsRequests: Request[] = []
	page.on("request", request => {
		if (isAnalyticsSummary(request)) analyticsRequests.push(request)
	})

	await page.goto("/dashboard")
	await expect(page).toHaveURL(/\/dashboard/)
	await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible()
	await expect(page.getByRole("region", { name: "Module entries today" })).toHaveCount(0)
	await page.waitForTimeout(1_000)
	expect(analyticsRequests).toHaveLength(0)
	expect(await page.locator("body").innerText()).not.toMatch(
		/eventId|sessionId|subjectPseudoId|properties/i
	)
	await assertCleanRuntime(failures)
	await captureAcceptanceScreenshot(page, "task-9-dashboard-denied.png")
})
