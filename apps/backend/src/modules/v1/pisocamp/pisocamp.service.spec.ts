import { PisoCampService } from "./pisocamp.service"

describe("PisoCampService", () => {
	it("returns only the safe public F1 defaults", async () => {
		const service = new PisoCampService()

		await expect(service.getPublicConfig()).resolves.toEqual({
			module_enabled: true,
			account_prompt_enabled: true,
			config_version: "seed-1",
		})
	})
})
