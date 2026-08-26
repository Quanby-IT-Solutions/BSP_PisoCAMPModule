import { describe, expect, it, vi } from "vitest"

import { contractClient, credentialedFetch, orpc } from "./client"

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

	it("injects typed per-call headers without dropping browser credentials", async () => {
		const requestId = "d7ef42f1-5a30-4fa7-9da5-c3af0d0bbb36"
		const request = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "38fd44f4-ebde-49b1-86e0-b6711ccf6756",
					contentType: "advisory",
					status: "draft",
					currentVersion: {
						id: "d7e9984f-fd54-49d9-bb33-0a7c006c83fd",
						versionNo: 1,
						status: "draft",
						content: {
							contentType: "advisory",
							title: "Counterfeit advisory",
							summary: "How to identify suspect notes.",
							body: "Bring suspect notes to an authorized bank.",
						},
						relatedLinks: [],
					},
					creator: { id: "user-1", name: "Content Editor" },
					lastEditor: { id: "user-1", name: "Content Editor" },
					createdAt: "2026-08-25T00:00:00.000Z",
					dateModified: "2026-08-25T00:00:00.000Z",
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			)
		)
		vi.stubGlobal("fetch", request)

		await contractClient.pisocamp.admin.content.create(
			{
				requestId,
				content: {
					contentType: "advisory",
					title: "Counterfeit advisory",
					summary: "How to identify suspect notes.",
					body: "Bring suspect notes to an authorized bank.",
				},
				relatedLinks: [],
			},
			{ context: { headers: { "Idempotency-Key": requestId } } }
		)

		const emittedRequest = request.mock.calls[0]?.[0]
		expect(emittedRequest).toBeInstanceOf(Request)
		expect((emittedRequest as Request).headers.get("Idempotency-Key")).toBe(requestId)
		expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ credentials: "include" }))
	})
})
