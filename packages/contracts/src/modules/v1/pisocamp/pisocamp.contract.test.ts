import { describe, expect, it } from "vitest"

import { v1Contract } from "../v1.contract.js"
import { pisoCampContract } from "./pisocamp.contract.js"

describe("Piso CAMP consent contract", () => {
	it("publishes exact unversioned paths for the v1 router to prefix once", () => {
		expect(pisoCampContract.consent.get["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/pisocamp/consent/{purpose}",
		})
		expect(pisoCampContract.consent.record["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/pisocamp/consent",
		})
	})

	it("composes the consent POST at the runtime v1 path", () => {
		expect(v1Contract.pisocamp.consent.record["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/v1/pisocamp/consent",
		})
	})
})
