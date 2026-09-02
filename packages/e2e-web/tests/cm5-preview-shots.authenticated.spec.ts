import path from "node:path"
import { expect, test } from "@playwright/test"

import { signInAs, signOutCompletely } from "../fixtures"

const ITEM_ID = "9c5b0000-0000-4000-8000-000000000051"
const PREVIEW_PATH = `/pisocamp/content/${ITEM_ID}/versions/3/preview`
const SHOT_DIR = process.env.CM5_SHOT_DIR

/**
 * Capture-only run for the acceptance record. Skipped unless CM5_SHOT_DIR is
 * set, so an ordinary suite run never writes into the repository.
 *
 * Run it on its own (`-g "captures the"`): it shares an acceptance database
 * with the assertion specs, and Playwright would otherwise run both files in
 * parallel workers against the same rows.
 */
test.describe("CM-5 preview evidence capture", () => {
	test.skip(!SHOT_DIR, "CM5_SHOT_DIR is not set")
	test.use({ storageState: { cookies: [], origins: [] } })

	test("captures the desktop and 320 px preview", async ({ page }) => {
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")

		await page.setViewportSize({ width: 1280, height: 900 })
		await page.goto(PREVIEW_PATH)
		await expect(page.getByRole("heading", { name: "NGC 1000 Piso banknote" })).toBeVisible()
		await expect(
			page.getByRole("img", { name: "Preview code for the Piso CAMP preview build" })
		).toBeVisible()
		await page.screenshot({
			path: path.join(SHOT_DIR!, "cm-5-preview-desktop.png"),
			fullPage: true,
		})

		await page.setViewportSize({ width: 320, height: 720 })
		await page.reload()
		await expect(page.getByRole("heading", { name: "NGC 1000 Piso banknote" })).toBeVisible()
		await page.screenshot({ path: path.join(SHOT_DIR!, "cm-5-preview-mobile.png"), fullPage: true })
	})
})
