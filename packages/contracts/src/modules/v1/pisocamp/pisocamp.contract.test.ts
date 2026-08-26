import { describe, expect, it } from "vitest"

import { v1Contract } from "../v1.contract.js"
import { pisoCampContract } from "./pisocamp.contract.js"

describe("Piso CAMP consent contract", () => {
	it("composes the CM-1 administration surface under admin.content", () => {
		expect(Object.keys(pisoCampContract.admin.content)).toEqual(["list", "get", "create", "update"])
		expect(v1Contract.pisocamp.admin.content.create["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/v1/admin/pisocamp/content",
		})
	})

	it("exposes the F3 catalog and authenticated profile routes", () => {
		expect(v1Contract.pisocamp.locations.get["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/v1/pisocamp/locations",
		})
		expect(v1Contract.pisocamp.profile.get["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/v1/pisocamp/profile",
		})
		expect(v1Contract.pisocamp.profile.upsert["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/v1/pisocamp/profile",
		})
	})
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
