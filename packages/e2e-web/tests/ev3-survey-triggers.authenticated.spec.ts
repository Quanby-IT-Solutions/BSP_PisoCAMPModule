import {
	expect,
	test,
	type APIRequestContext,
	type ConsoleMessage,
	type Page,
	type Request,
	type Response,
} from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

const API_ORIGIN = process.env.EV3_E2E_API_ORIGIN ?? "http://localhost:3000"
const ADMIN_API = `${API_ORIGIN}/api/v1/admin/pisocamp/content`

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

async function send(
	api: APIRequestContext,
	method: "post" | "put",
	url: string,
	data: Record<string, unknown>
) {
	const requestId = crypto.randomUUID()
	const response = await api[method](url, {
		headers: { "Idempotency-Key": requestId },
		data: { ...data, requestId },
	})
	expect(response.status(), url).toBe(200)
	return response.json() as Promise<{ id: string }>
}

/** A published survey a rule can be arranged for. */
async function publishedSurvey(api: APIRequestContext, title: string) {
	const created = await send(api, "post", ADMIN_API, {
		content: {
			contentType: "survey",
			title,
			summary: "A short evaluation shown after a topic.",
			body: "Answering is optional and takes less than a minute.",
			purpose: "satisfaction",
			subjectContentItemId: null,
			questions: [
				{
					kind: "rating",
					prompt: "How clear was this topic?",
					required: true,
					lowLabel: "Not clear at all",
					highLabel: "Very clear",
				},
			],
		},
		relatedLinks: [],
	})
	await send(api, "post", `${ADMIN_API}/${created.id}/submit`, {
		itemId: created.id,
		expectedVersionNo: 1,
		comments: "Ready for review",
	})
	await send(api, "post", `${ADMIN_API}/${created.id}/approve`, {
		itemId: created.id,
		expectedVersionNo: 2,
		comments: "Checked",
	})
	await send(api, "post", `${ADMIN_API}/${created.id}/publish`, {
		itemId: created.id,
		expectedVersionNo: 3,
	})
	return created.id
}

/**
 * EV-3 in a real browser.
 *
 * The unit suites prove the rules; this proves a person can actually arrange
 * one — that the console and the network stay clean while they do, and that
 * the screen is operable by keyboard at 320 px.
 */
test.describe("EV-3 arranging survey triggers in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("arranges a rule and shows it in the list", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const suffix = crypto.randomUUID().slice(0, 8)
		const itemId = await publishedSurvey(page.request, `EV-3 survey ${suffix}`)

		await page.goto("/pisocamp/survey-triggers")
		await expect(page.getByRole("heading", { name: "Survey Triggers", level: 1 })).toBeVisible()
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Survey content ID").fill(itemId)
		await page.getByLabel("Frequency cap (days)").fill("14")
		await page.getByLabel("Priority", { exact: true }).fill("5")
		await page.getByRole("button", { name: "Save Rule" }).click()

		await expect(page.getByText("Rule saved.", { exact: false })).toBeVisible({
			timeout: 20_000,
		})
		const row = page.getByRole("row", { name: new RegExp(`EV-3 survey ${suffix}`) })
		await expect(row).toBeVisible({ timeout: 20_000 })
		await expect(row).toContainText("Topic completion")
		await expect(row).toContainText("Once per 14 days")

		expectClean(observed)
	})

	test("asks for a depth only when the trigger needs one", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/survey-triggers")
		await page.waitForLoadState("networkidle")

		await expect(page.getByLabel("Page depth")).toHaveCount(0)
		await page.getByRole("combobox", { name: "Trigger" }).click()
		await page.getByRole("option", { name: "Page depth", exact: true }).click()
		await expect(page.getByLabel("Page depth")).toBeVisible()

		// Saving without one says why rather than failing quietly at the server.
		await page.getByLabel("Survey content ID").fill(crypto.randomUUID())
		await page.getByRole("button", { name: "Save Rule" }).click()
		// By its text: the page has other alert regions, and the one that matters
		// is the message beside the field.
		await expect(
			page.getByText("A page-depth trigger needs a depth.")
		).toBeVisible()

		expectClean(observed)
	})

	test("removes a rule", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const suffix = crypto.randomUUID().slice(0, 8)
		const itemId = await publishedSurvey(page.request, `EV-3 removable ${suffix}`)

		await page.goto("/pisocamp/survey-triggers")
		await page.waitForLoadState("networkidle")
		await page.getByLabel("Survey content ID").fill(itemId)
		await page.getByRole("button", { name: "Save Rule" }).click()
		const row = page.getByRole("row", { name: new RegExp(`EV-3 removable ${suffix}`) })
		await expect(row).toBeVisible({ timeout: 20_000 })

		await row.getByRole("button", { name: /^Remove /i }).click()

		await expect(row).toHaveCount(0, { timeout: 20_000 })

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.goto("/pisocamp/survey-triggers")
		await expect(page.getByRole("heading", { name: "Survey Triggers" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const survey = page.getByLabel("Survey content ID")
		await survey.focus()
		await expect(survey).toBeFocused()
		expect((await survey.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		const trigger = page.getByRole("combobox", { name: "Trigger" })
		await trigger.focus()
		await expect(trigger).toBeFocused()
		expect((await trigger.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the screen to a user without surveys.triggers.configure", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		await page.goto("/pisocamp/survey-triggers")

		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Survey Triggers" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
