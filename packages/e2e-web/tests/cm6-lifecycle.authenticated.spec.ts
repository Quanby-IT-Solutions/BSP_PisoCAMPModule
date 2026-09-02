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

const API_ORIGIN = process.env.CM6_E2E_API_ORIGIN ?? "http://localhost:3000"
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

function expectClean(observed: Observed, allowResponse?: (url: string) => boolean) {
	const permitted = allowResponse
		? observed.badResponses.filter(entry => allowResponse(entry.split(" ").slice(1).join(" ")))
		: []
	const consoleErrors = observed.consoleErrors.filter(
		message => !(permitted.length > 0 && /Failed to load resource/.test(message))
	)

	expect(observed.pageErrors, "unhandled page errors").toEqual([])
	expect(consoleErrors, "console errors and warnings").toEqual([])
	expect(observed.failedRequests, "failed requests").toEqual([])
	expect(
		observed.badResponses.filter(entry => !permitted.includes(entry)),
		"error responses"
	).toEqual([])
}

async function post(api: APIRequestContext, url: string, data: Record<string, unknown>) {
	const requestId = crypto.randomUUID()
	const response = await api.post(url, {
		headers: { "Idempotency-Key": requestId },
		data: { ...data, requestId },
	})
	expect(response.status(), url).toBe(200)
	return response.json() as Promise<{
		id: string
		status: string
		publishAt: string | null
		currentVersion: { versionNo: number; approval: unknown; publication: unknown }
	}>
}

/**
 * Build a fresh item through the real workflow.
 *
 * Every CM-6 transition is one-way, so a static fixture would be spent after
 * one run. Creating the item per test keeps the suite repeatable and exercises
 * CM-1 and CM-3 on the way in.
 */
async function createItem(
	api: APIRequestContext,
	to: "approved" | "published"
): Promise<{ itemId: string; versionNo: number }> {
	const suffix = crypto.randomUUID().slice(0, 8)
	const created = await post(api, ADMIN_API, {
		content: {
			contentType: "advisory",
			title: `CM-6 lifecycle ${suffix}`,
			summary: "Advisory created for the CM-6 acceptance run.",
			body: "This advisory exists to exercise withdrawal and scheduling.",
		},
		relatedLinks: [],
	})
	await post(api, `${ADMIN_API}/${created.id}/submit`, {
		itemId: created.id,
		expectedVersionNo: 1,
		comments: "Ready",
	})
	const approved = await post(api, `${ADMIN_API}/${created.id}/approve`, {
		itemId: created.id,
		expectedVersionNo: 2,
		comments: "Checked",
	})
	if (to === "approved") return { itemId: created.id, versionNo: approved.currentVersion.versionNo }

	const published = await post(api, `${ADMIN_API}/${created.id}/publish`, {
		itemId: created.id,
		expectedVersionNo: 3,
	})
	return { itemId: created.id, versionNo: published.currentVersion.versionNo }
}

async function bundleItemIds(api: APIRequestContext): Promise<string[]> {
	const response = await api.get(`${API_ORIGIN}/api/v1/pisocamp/bundle/manifest`)
	if (!response.ok()) return []
	const envelope = (await response.json()) as { payload?: string }
	if (!envelope.payload) return []
	const manifest = JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")) as {
		entries?: { contentItemId?: string | null }[]
	}
	return (manifest.entries ?? []).flatMap(entry =>
		entry.contentItemId ? [entry.contentItemId] : []
	)
}

test.describe("CM-6 withdrawal and scheduled publication in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("unpublishes live content after confirming, and drops it from the published set", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const { itemId } = await createItem(page.request, "published")

		await page.goto(`/pisocamp/content/review/${itemId}`)
		await expect(page.getByRole("heading", { name: "Publication Lifecycle" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		// A destructive step is behind a confirmation that says what users see.
		const trigger = page.getByRole("button", { name: "Unpublish" })
		await trigger.focus()
		await trigger.press("Enter")
		await expect(page.getByText("Unpublish this content?")).toBeVisible()
		await expect(page.getByText(/removed from the app at the next bundle build/i)).toBeVisible()

		const unpublished = page.waitForResponse(
			response =>
				response.url().includes(`/content/${itemId}/unpublish`) &&
				response.request().method() === "POST"
		)
		const confirm = page.getByRole("button", { name: "Confirm Unpublish" })
		await expect(confirm).toBeEnabled()
		await confirm.focus()
		await confirm.press("Enter")

		const response = await unpublished
		expect(response.status()).toBe(200)
		const detail = (await response.json()) as {
			status: string
			currentVersion: { versionNo: number; approval: unknown; publication: unknown }
		}
		expect(detail.status).toBe("unpublished")
		expect(detail.currentVersion.versionNo).toBe(5)
		// Provenance survives the withdrawal.
		expect(detail.currentVersion.approval).not.toBeNull()
		expect(detail.currentVersion.publication).not.toBeNull()

		await expect(page.getByRole("status").filter({ hasText: "Lifecycle Updated" })).toBeVisible()
		expect(await bundleItemIds(page.request)).not.toContain(itemId)

		expectClean(observed)
	})

	test("deactivates a live item in one step, then archives it", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const { itemId } = await createItem(page.request, "published")

		for (const [action, expected] of [
			["Deactivate", "deactivated"],
			["Archive", "archived"],
		] as const) {
			await page.goto(`/pisocamp/content/review/${itemId}`)
			await expect(page.getByRole("heading", { name: "Publication Lifecycle" })).toBeVisible()
			await page.waitForLoadState("networkidle")

			const trigger = page.getByRole("button", { name: action })
			await trigger.focus()
			await trigger.press("Enter")
			const confirm = page.getByRole("button", { name: `Confirm ${action}` })
			await expect(confirm).toBeEnabled()
			const settled = page.waitForResponse(
				result =>
					result.url().includes(`/content/${itemId}/${action.toLowerCase()}`) &&
					result.request().method() === "POST"
			)
			await confirm.focus()
			await confirm.press("Enter")

			const response = await settled
			expect(response.status()).toBe(200)
			expect(((await response.json()) as { status: string }).status).toBe(expected)
		}

		// An archived item offers no further lifecycle control.
		await page.goto(`/pisocamp/content/review/${itemId}`)
		await expect(page.getByRole("heading", { name: "Workflow History" })).toBeVisible()
		await expect(page.getByRole("button", { name: /Unpublish|Deactivate|Archive/ })).toHaveCount(0)

		expectClean(observed)
	})

	test("schedules and clears a publication on approved content", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const { itemId } = await createItem(page.request, "approved")

		await page.goto(`/pisocamp/content/review/${itemId}`)
		const field = page.getByLabel("Scheduled publication")
		await expect(field).toBeVisible()
		await page.waitForLoadState("networkidle")

		const future = new Date(Date.now() + 3 * 86_400_000)
		const localValue = new Date(future.getTime() - future.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 16)
		await field.fill(localValue)

		const scheduled = page.waitForResponse(
			result =>
				result.url().includes(`/content/${itemId}/schedule`) && result.request().method() === "PUT"
		)
		const save = page.getByRole("button", { name: "Save Schedule" })
		await save.focus()
		await save.press("Enter")

		const response = await scheduled
		expect(response.status()).toBe(200)
		const detail = (await response.json()) as { status: string; publishAt: string | null }
		expect(detail.status).toBe("approved")
		expect(detail.publishAt).not.toBeNull()
		expect(new Date(detail.publishAt!).getTime()).toBeGreaterThan(Date.now())

		const cleared = page.waitForResponse(
			result =>
				result.url().includes(`/content/${itemId}/schedule`) && result.request().method() === "PUT"
		)
		const clear = page.getByRole("button", { name: "Clear Schedule" })
		await expect(clear).toBeEnabled()
		await clear.focus()
		await clear.press("Enter")
		const clearedResponse = await cleared
		expect(clearedResponse.status()).toBe(200)
		expect(((await clearedResponse.json()) as { publishAt: string | null }).publishAt).toBeNull()

		expectClean(observed)
	})

	test("keeps the lifecycle card usable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const { itemId } = await createItem(page.request, "published")

		await page.goto(`/pisocamp/content/review/${itemId}`)
		await expect(page.getByRole("heading", { name: "Publication Lifecycle" })).toBeVisible()

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const unpublish = page.getByRole("button", { name: "Unpublish" })
		await unpublish.focus()
		await expect(unpublish).toBeFocused()
		expect((await unpublish.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses every lifecycle route to an editor without content.items.publish", async ({
		page,
	}) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const { itemId } = await createItem(page.request, "approved")

		await signOutCompletely(page)
		await signInAs(page, "contentEditor")

		for (const path of ["unpublish", "deactivate", "archive"]) {
			const requestId = crypto.randomUUID()
			const denied = await page.request.post(`${ADMIN_API}/${itemId}/${path}`, {
				headers: { "Idempotency-Key": requestId },
				data: { itemId, requestId, expectedVersionNo: 3 },
			})
			expect(denied.status(), path).toBe(403)
		}

		const scheduleRequestId = crypto.randomUUID()
		const deniedSchedule = await page.request.put(`${ADMIN_API}/${itemId}/schedule`, {
			headers: { "Idempotency-Key": scheduleRequestId },
			data: {
				itemId,
				requestId: scheduleRequestId,
				expectedVersionNo: 3,
				publishAt: new Date(Date.now() + 86_400_000).toISOString(),
			},
		})
		expect(deniedSchedule.status()).toBe(403)

		expectClean(observed, url => url.endsWith("/api/v1/rbac/users"))
	})
})
