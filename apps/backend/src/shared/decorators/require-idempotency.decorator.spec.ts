import { Reflector } from "@nestjs/core"

import { IDEMPOTENCY_REQUIREMENT_KEY, RequireIdempotency } from "./require-idempotency.decorator"

describe("RequireIdempotency", () => {
	it("publishes the configured request-id and active-account policy as Nest metadata", () => {
		class TestController {
			@RequireIdempotency({ requestIdField: "requestId", requireActiveAccount: true })
			mutate() {}
		}

		const requirement = new Reflector().get(
			IDEMPOTENCY_REQUIREMENT_KEY,
			TestController.prototype.mutate
		)

		expect(requirement).toEqual({
			requestIdField: "requestId",
			requireActiveAccount: true,
		})
	})
})
