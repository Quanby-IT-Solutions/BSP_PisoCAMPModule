import { type INestApplication } from "@nestjs/common"
import request from "supertest"
import { type App } from "supertest/types"

import { createApplication } from "../src/bootstrap"
import { beforeEach, describe, expect, it } from "@jest/globals"

describe("Application shell (e2e)", () => {
	let app: INestApplication<App>

	beforeEach(async () => {
		// The real production configuration — auth middleware, CORS, helmet, body
		// parsers, versioning — rather than a hand-rolled approximation of it.
		app = (await createApplication()) as INestApplication<App>
		await app.init()
	})

	it("/api/v1/health (GET) reports the database it depends on", async () => {
		const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200)

		expect(response.body).toEqual(
			expect.objectContaining({
				status: "ok",
				checks: expect.objectContaining({
					database: expect.objectContaining({ status: "up" }),
				}),
			})
		)
	})

	it("serves routes only under the version prefix", async () => {
		// What matters is that routes are version-scoped: v1 serves them, the
		// unversioned path does not. Asserted directly rather than inferred from a
		// payload field.
		await request(app.getHttpServer()).get("/api/v1/pisocamp/config").expect(200)
		await request(app.getHttpServer()).get("/api/pisocamp/config").expect(404)
	})

	it("exposes the public Piso CAMP configuration without a session", async () => {
		const response = await request(app.getHttpServer()).get("/api/v1/pisocamp/config").expect(200)

		// Public keys only — a guest reads this before any account exists (F1).
		expect(response.body).toEqual(
			expect.objectContaining({
				module_enabled: expect.any(Boolean),
				account_prompt_enabled: expect.any(Boolean),
			})
		)
	})
})
