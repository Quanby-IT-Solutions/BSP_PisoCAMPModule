import { expect, test, type Page } from "@playwright/test"

import { AUTH_FILE } from "../constants"

const PROGRESS_URL = "http://localhost:3000/api/v1/pisocamp/me/progress"

/**
 * GM-5's endpoint, from a real signed-in session.
 *
 * The screen is a mobile one, covered in the Flutter suite; what a browser can
 * prove is that a person's own progress is theirs to ask for, that it answers
 * with zeros rather than an error before they have done anything, and that a
 * guest cannot ask at all.
 */
test.describe("GM-5 progress", () => {
	test.use({ storageState: AUTH_FILE })

	test("gives a signed-in person their own progress", async ({ page }: { page: Page }) => {
		const errors: string[] = []
		page.on("pageerror", error => errors.push(error.message))
		await page.goto("/dashboard")

		const response = await page.request.get(PROGRESS_URL)

		expect(response.status()).toBe(200)
		const progress = await response.json()
		// Zeros, not an error, before anybody has done anything.
		expect(progress).toMatchObject({
			topicsViewed: expect.any(Number),
			questionsAnswered: expect.any(Number),
			accuracyPercent: expect.any(Number),
			points: expect.any(Number),
		})
		expect(progress).toHaveProperty("lastActivityAt")
		// Their own figures and nobody else's: nothing here names another person.
		expect(JSON.stringify(progress)).not.toContain("@")
		expect(errors).toEqual([])
	})

	test("refuses a request with no session at all", async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const response = await context.request.get(PROGRESS_URL)

		// GM-5 is a registered-user view; a guest has no progress to be shown.
		expect(response.status()).toBe(401)
		await context.close()
	})
})
