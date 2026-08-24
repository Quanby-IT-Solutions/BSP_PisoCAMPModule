import { describe, expect, it, vi } from "vitest"

import { credentialedFetch, orpc } from "./client"

describe("browser oRPC client", () => {
	it("sends a real contract request to exactly one versioned path with credentials", async () => {
		const request = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ session_inactivity_minutes: 30 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		)
		vi.stubGlobal("fetch", request)
		const options = orpc.pisocamp.admin.config.get.queryOptions()

		await options.queryFn?.({
			queryKey: options.queryKey,
			signal: new AbortController().signal,
			meta: undefined,
			pageParam: undefined,
			direction: "forward",
			client: undefined as never,
		})

		expect(request).toHaveBeenCalledTimes(1)
		const emittedRequest = request.mock.calls[0]?.[0]
		expect(emittedRequest).toBeInstanceOf(Request)
		expect((emittedRequest as Request).url).toBe(
			"http://localhost:3000/api/v1/admin/pisocamp/config"
		)
		expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ credentials: "include" }))
	})

	it("includes browser credentials on requests", async () => {
		const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

		await credentialedFetch("http://localhost/test", { method: "GET" }, request)

		expect(request).toHaveBeenCalledWith(
			"http://localhost/test",
			expect.objectContaining({ method: "GET", credentials: "include" })
		)
	})
})
