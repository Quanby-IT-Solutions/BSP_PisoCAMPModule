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

const API_ORIGIN = process.env.CM7_E2E_API_ORIGIN ?? "http://localhost:3000"
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

/** create → edit → submit → approve → publish, so the trail has five entries. */
async function itemWithHistory(api: APIRequestContext): Promise<string> {
	const suffix = crypto.randomUUID().slice(0, 8)
	const created = await send(api, "post", ADMIN_API, {
		content: {
			contentType: "advisory",
			title: `CM-7 audit ${suffix}`,
			summary: "Advisory created for the CM-7 acceptance run.",
			body: "This advisory exists to exercise the audit history view.",
		},
		relatedLinks: [],
	})
	await send(api, "put", `${ADMIN_API}/${created.id}`, {
		itemId: created.id,
		expectedVersionNo: 1,
		content: {
			contentType: "advisory",
			title: `CM-7 audit ${suffix}`,
			summary: "Advisory created for the CM-7 acceptance run.",
			body: "Edited body copy, so the trail records an edit.",
		},
		relatedLinks: [],
	})
	await send(api, "post", `${ADMIN_API}/${created.id}/submit`, {
		itemId: created.id,
		expectedVersionNo: 2,
		comments: "Ready for review",
	})
	await send(api, "post", `${ADMIN_API}/${created.id}/approve`, {
		itemId: created.id,
		expectedVersionNo: 3,
		comments: "Checked against the BSP source",
	})
	await send(api, "post", `${ADMIN_API}/${created.id}/publish`, {
		itemId: created.id,
		expectedVersionNo: 4,
	})
	return created.id
}

test.describe("CM-7 content audit history in a real browser", () => {
	test.describe.configure({ mode: "serial" })
	test.use({ storageState: { cookies: [], origins: [] } })

	test("shows the whole trail with actor, time, states and comments", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const itemId = await itemWithHistory(page.request)

		await page.goto(`/pisocamp/content/${itemId}/audit`)
		await expect(page.getByRole("heading", { name: "Audit History", level: 1 })).toBeVisible()
		await expect(page.getByText("5 Recorded Entries")).toBeVisible()

		const list = page.getByRole("list").last()
		// Exact: "Published" is both a badge and half of the state change beside it.
		await expect(list.getByText("Published", { exact: true })).toBeVisible()
		await expect(list.getByText("Approved → Published")).toBeVisible()
		await expect(list.getByText("Checked against the BSP source")).toBeVisible()
		await expect(list.getByText("Ready for review")).toBeVisible()
		await expect(list.getByText("Edited", { exact: true })).toBeVisible()
		await expect(list.getByText("Created", { exact: true })).toBeVisible()
		await expect(list.getByText("Admin User").first()).toBeVisible()

		expectClean(observed)
	})

	test("narrows by action and clears back to the whole trail", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const itemId = await itemWithHistory(page.request)

		await page.goto(`/pisocamp/content/${itemId}/audit`)
		await expect(page.getByText("5 Recorded Entries")).toBeVisible()
		// Rendered is not hydrated: a native select change before hydration sets
		// the DOM value and reaches no React handler.
		await page.waitForLoadState("networkidle")

		await page.getByLabel("Action").selectOption("content.approve")
		await expect(page.getByText("1 Recorded Entries")).toBeVisible()
		await expect(page.getByRole("list").last().getByText("Approved", { exact: true })).toBeVisible()

		await page.getByLabel("Action").selectOption("content.reject")
		await expect(page.getByText("No Matching Entries")).toBeVisible()
		await expect(page.getByText(/Clear them to see the whole history/i)).toBeVisible()

		const clear = page.getByRole("button", { name: "Clear Filters" })
		await clear.focus()
		await clear.press("Enter")
		await expect(page.getByText("5 Recorded Entries")).toBeVisible()

		expectClean(observed)
	})

	test("stays readable and operable by keyboard at 320 px", async ({ page }) => {
		const observed = observe(page)
		await page.setViewportSize({ width: 320, height: 720 })
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const itemId = await itemWithHistory(page.request)

		await page.goto(`/pisocamp/content/${itemId}/audit`)
		await expect(page.getByRole("heading", { name: "Audit History" })).toBeVisible()

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
		expect(overflow, "horizontal overflow at 320 px").toBeLessThanOrEqual(0)

		const actor = page.getByLabel("Actor")
		await actor.focus()
		await expect(actor).toBeFocused()
		expect((await actor.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

		expectClean(observed)
	})

	test("refuses the trail to an editor without content.audit.view", async ({ page }) => {
		const observed = observe(page)
		await signOutCompletely(page)
		await signInAs(page, "contentAdmin")
		const itemId = await itemWithHistory(page.request)

		await signOutCompletely(page)
		await signInAs(page, "contentEditor")

		await page.goto(`/pisocamp/content/${itemId}/audit`)
		await expect(page).toHaveURL(/\/dashboard/)
		await expect(page.getByRole("heading", { name: "Audit History" })).toHaveCount(0)

		const denied = await page.request.get(`${ADMIN_API}/${itemId}/audit`)
		expect(denied.status()).toBe(403)

		expectClean(observed, url => url.endsWith("/api/v1/rbac/users"))
	})
})
