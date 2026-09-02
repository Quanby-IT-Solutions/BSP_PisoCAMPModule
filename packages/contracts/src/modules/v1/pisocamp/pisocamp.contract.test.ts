import { describe, expect, it } from "vitest"

import { v1Contract } from "../v1.contract.js"
import { pisoCampContract } from "./pisocamp.contract.js"

describe("Piso CAMP consent contract", () => {
	it("composes the CE-1 public bundle surface", () => {
		expect(Object.keys(pisoCampContract.bundle)).toEqual(["manifest", "resource"])
		expect(v1Contract.pisocamp.bundle.manifest.get["~orpc"].route).toMatchObject({
			method: "GET",
			path: "/v1/pisocamp/bundle/manifest",
		})
	})

	it("composes the CM-1 administration surface under admin.content", () => {
		expect(Object.keys(pisoCampContract.admin.content)).toEqual(
			expect.arrayContaining(["list", "get", "create", "update"])
		)
		expect(v1Contract.pisocamp.admin.content.create["~orpc"].route).toMatchObject({
			method: "POST",
			path: "/v1/admin/pisocamp/content",
		})
	})

	it("composes the CM-3 workflow surface under the same administration contract", () => {
		expect(Object.keys(pisoCampContract.admin.content)).toEqual([
			"list",
			"get",
			"create",
			"update",
			"reviewQueue",
			"review",
			"submit",
			"approve",
			"reject",
			"publish",
			"unpublish",
			"deactivate",
			"archive",
			"schedule",
			"versions",
			"restore",
		])
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
