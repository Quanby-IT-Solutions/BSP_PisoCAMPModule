import { type INestApplication } from "@nestjs/common"
import express, { type NextFunction, type Request, type Response } from "express"
import request from "supertest"

import { configureApp, MAX_REQUEST_BODY_SIZE } from "@/config/app.config"

// `app.config` pulls in `@repo/auth`, which pulls the `better-auth` ESM chain
// this jest config does not transform. Stubbed as the other config specs do —
// the limit constant under test is app.config's own and is unaffected.
jest.mock("@repo/auth", () => ({
	createAuth: jest.fn(),
	auth: {},
}))

/**
 * AB-4 / F-14 — request bodies are bounded.
 *
 * Both parsers were unbounded, so any mutation endpoint would buffer an
 * arbitrarily large body into memory before application code ran. These
 * exercise the real `express.json`/`express.urlencoded` middleware with the
 * shipped limit rather than asserting on the constant, because the limit only
 * matters if the parser actually enforces it.
 */

function appWithLimits() {
	const app = express()
	const processOn = jest.spyOn(process, "on").mockImplementation(() => process)
	try {
		configureApp({
			getHttpAdapter: () => app,
			close: async () => undefined,
		} as unknown as INestApplication)
	} finally {
		processOn.mockRestore()
	}
	app.post("/echo", (_req, res) => res.status(200).json({ ok: true }))
	app.post("/api/v1/pisocamp/events", (_req, res) => res.status(200).json({ parsed: true }))
	app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
		const failure = error as { status?: number; message?: string }
		response.status(failure.status ?? 500).json({ message: failure.message })
	})
	return app
}

/** A JSON body of roughly `kb` kilobytes. */
function jsonBodyOf(kb: number) {
	return { concern: "x".repeat(kb * 1024) }
}

function rawJsonBodyOfSize(byteLength: number): string {
	const prefix = '{"padding":"'
	const suffix = '"}'
	return `${prefix}${"x".repeat(byteLength - Buffer.byteLength(prefix + suffix))}${suffix}`
}

describe("request body limits", () => {
	it("is configured at 100kb", () => {
		expect(MAX_REQUEST_BODY_SIZE).toBe("100kb")
	})

	it("keeps the 100 KiB JSON limit on unrelated routes", async () => {
		const response = await request(appWithLimits()).post("/echo").send(jsonBodyOf(200))

		expect(response.status).toBe(413)
	})

	it("rejects an oversized urlencoded body with 413", async () => {
		const response = await request(appWithLimits())
			.post("/echo")
			.type("form")
			.send(`concern=${"x".repeat(200 * 1024)}`)

		expect(response.status).toBe(413)
	})

	it("accepts the largest legitimate payload", async () => {
		// The biggest field this app accepts is a support ticket's `concern`,
		// capped at 5000 characters by the contract. Even as 4-byte UTF-8 that is
		// ~20kb, so a 5000-character concern must pass with room to spare.
		const response = await request(appWithLimits())
			.post("/echo")
			.send({
				name: "Reporter",
				email: "reporter@example.com",
				subject: "A representative subject line",
				concern: "é".repeat(5000),
			})

		expect(response.status).toBe(200)
	})

	it("accepts a body just under the limit", async () => {
		const response = await request(appWithLimits()).post("/echo").send(jsonBodyOf(90))

		expect(response.status).toBe(200)
	})

	it("still accepts an ordinary small body", async () => {
		const response = await request(appWithLimits())
			.post("/echo")
			.send({ title: "an ordinary todo" })

		expect(response.status).toBe(200)
	})

	it("scopes bodies above 100 KiB to the exact analytics ingestion route", async () => {
		const body = rawJsonBodyOfSize(132_412)
		const analytics = await request(appWithLimits())
			.post("/api/v1/pisocamp/events")
			.set("Content-Type", "application/json")
			.send(body)
		const unrelated = await request(appWithLimits())
			.post("/echo")
			.set("Content-Type", "application/json")
			.send(body)

		expect(analytics.status).toBe(200)
		expect(unrelated.status).toBe(413)
	})

	it("lets a 524287-byte analytics body reach the route", async () => {
		const body = rawJsonBodyOfSize(524_287)
		expect(Buffer.byteLength(body)).toBe(524_287)

		const response = await request(appWithLimits())
			.post("/api/v1/pisocamp/events")
			.set("Content-Type", "application/json")
			.send(body)

		expect(response.status).toBe(200)
		expect(response.body).toEqual({ parsed: true })
	})

	it("returns a safe 413 for a 524289-byte analytics body", async () => {
		const body = rawJsonBodyOfSize(524_289)
		expect(Buffer.byteLength(body)).toBe(524_289)

		const response = await request(appWithLimits())
			.post("/api/v1/pisocamp/events")
			.set("Content-Type", "application/json")
			.send(body)

		expect(response.status).toBe(413)
		expect(response.body).toEqual({ message: "Request body exceeds the 512 KiB limit" })
	})
})
