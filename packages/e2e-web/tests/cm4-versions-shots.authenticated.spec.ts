import path from "node:path"
import { expect, test } from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

const ITEM_ID = "9c5b0000-0000-4000-8000-000000000052"
const HISTORY_PATH = `/pisocamp/content/${ITEM_ID}/versions`
const SHOT_DIR = process.env.CM4_SHOT_DIR

/**
 * Capture-only run for the acceptance record; skipped unless CM4_SHOT_DIR is set.
 *
 * Run it on its own (`-g "captures the"`): it shares an acceptance database
 * with the assertion specs, and Playwright would otherwise run both files in
 * parallel workers against the same rows.
 */
test.describe("CM-4 version history evidence capture", () => {
	test.skip(!SHOT_DIR, "CM4_SHOT_DIR is not set")
	test.use({ storageState: { cookies: [], origins: [] } })

	test("captures the desktop and 320 px history", async ({ page }) => {
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.setViewportSize({ width: 1280, height: 900 })
		await page.goto(HISTORY_PATH)
		await expect(page.getByRole("heading", { name: "Version History" })).toBeVisible()
		await page.screenshot({
			path: path.join(SHOT_DIR!, "cm-4-version-history-desktop.png"),
			fullPage: true,
		})

		await page.setViewportSize({ width: 320, height: 720 })
		await page.reload()
		await expect(page.getByRole("heading", { name: "Version History" })).toBeVisible()
		await page.screenshot({
			path: path.join(SHOT_DIR!, "cm-4-version-history-mobile.png"),
			fullPage: true,
		})
	})
})
