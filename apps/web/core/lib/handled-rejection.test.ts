import { describe, expect, it } from "vitest"

import { alreadyReported } from "./handled-rejection"

describe("alreadyReported", () => {
	it("passes a successful result straight through", async () => {
		await expect(alreadyReported(Promise.resolve("done"))).resolves.toBe("done")
	})

	it("resolves to nothing when the work failed", async () => {
		// The failure is displayed from the mutation's own state; letting it
		// escape here made every failed submit an unhandled page error.
		await expect(alreadyReported(Promise.reject(new Error("nope")))).resolves.toBeUndefined()
	})

	it("does not leave the rejection unhandled", async () => {
		const rejections: unknown[] = []
		const listener = (event: PromiseRejectionEvent) => rejections.push(event.reason)
		window.addEventListener("unhandledrejection", listener)

		await alreadyReported(Promise.reject(new Error("nope")))
		await new Promise(resolve => setTimeout(resolve, 10))

		window.removeEventListener("unhandledrejection", listener)
		expect(rejections).toEqual([])
	})
})
