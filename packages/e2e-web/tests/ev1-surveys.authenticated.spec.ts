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

async function openSurveyForm(page: Page) {
	await page.goto("/pisocamp/content/new")
	await expect(page.getByRole("combobox", { name: "Content type" })).toBeVisible()
	await page.waitForLoadState("networkidle")
	await chooseSelect(page, "Content type", "Survey")
}

/**
 * EV-1 in a real browser.
 *
 * The jsdom suite proves the form's behaviour; this proves that a person can
 * actually author a survey — that the controls exist on the rendered page, that
 * the console and the network stay clean while they do, and that the screen is
 * operable by keyboard at 320 px.
 */
test.describe("EV-1 authoring a survey in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("creates a survey with a rating and a written question", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openSurveyForm(page)

		const suffix = crypto.randomUUID().slice(0, 8)
		await page.getByLabel("Title", { exact: true }).fill(`EV-1 survey ${suffix}`)
		await page.getByLabel("Summary", { exact: true }).fill("A short evaluation after a topic.")
		await page.getByLabel("Body", { exact: true }).fill("Answering is optional.")
		await chooseSelect(page, "Purpose", "Satisfaction")

		await page.getByLabel("Question 1").fill("How clear was this topic?")
		await page.getByLabel("Wording at 1").fill("Not clear at all")
		await page.getByLabel("Wording at 5").fill("Very clear")
		await page.getByRole("button", { name: "Add question" }).click()
		await chooseSelect(page, "Answer type", "Written answer", 1)
		await page.getByLabel("Question 2").fill("What would you change?")

		await page.getByRole("button", { name: /save draft/i }).click()

		await expect(page).toHaveURL(/\/pisocamp\/content$/)
		// The row, not the first text match: the list renders a card layout and a
		// table, and at this width the cards are the hidden half.
		await expect(
			page.getByRole("link", { name: `Edit EV-1 survey ${suffix}` })
		).toBeVisible({ timeout: 20_000 })

		expectClean(observed)
	})

	test("shows the scale wording the answer type asks for", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openSurveyForm(page)

		await expect(page.getByLabel("Wording at 1")).toBeVisible()
		await expect(page.getByLabel("Wording at 5")).toBeVisible()

		await chooseSelect(page, "Answer type", "Net promoter score (0-10)")
		await expect(page.getByLabel("Wording at 0")).toBeVisible()
		await expect(page.getByLabel("Wording at 10")).toBeVisible()

		await chooseSelect(page, "Answer type", "Written answer")
		await expect(page.getByLabel("Wording at 0")).toHaveCount(0)

		expectClean(observed)
	})

	test("refuses an NPS survey that never asks the NPS question", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openSurveyForm(page)

		await page.getByLabel("Title", { exact: true }).fill("EV-1 NPS without the question")
		await page.getByLabel("Summary", { exact: true }).fill("A short evaluation.")
		await page.getByLabel("Body", { exact: true }).fill("Answering is optional.")
		await chooseSelect(page, "Purpose", "Net promoter score")
		await page.getByLabel("Question 1").fill("How clear was this topic?")
		await page.getByLabel("Wording at 1").fill("Not clear at all")
		await page.getByLabel("Wording at 5").fill("Very clear")

		await page.getByRole("button", { name: /save draft/i }).click()

		await expect(page.getByText("An NPS survey must ask the NPS question")).toBeVisible()
		await expect(page).toHaveURL(/\/pisocamp\/content\/new/)

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		await openSurveyForm(page)

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const purpose = page.getByRole("combobox", { name: "Purpose" })
		await purpose.focus()
		await expect(purpose).toBeFocused()
		expect((await purpose.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		const prompt = page.getByLabel("Question 1")
		await prompt.focus()
		await expect(prompt).toBeFocused()
		expect((await prompt.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		const add = page.getByRole("button", { name: "Add question" })
		await add.focus()
		await add.press("Enter")
		await expect(page.getByLabel("Question 2")).toBeVisible()

		expectClean(observed)
	})

	test("refuses the form to a user without content.items.edit", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "userA")

		await page.goto("/pisocamp/content/new")

		await expect(page.getByRole("combobox", { name: "Purpose" })).toHaveCount(0)
		expect(observed.pageErrors, "unhandled page errors").toEqual([])
	})
})
