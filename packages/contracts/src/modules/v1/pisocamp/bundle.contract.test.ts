import { describe, expect, it } from "vitest"
import type { z } from "zod"

import { v1Contract } from "../v1.contract.js"
import { pisoCampBundleContract } from "./bundle.contract.js"

function parse(schema: unknown, value: unknown): unknown {
	return (schema as z.ZodType).parse(value)
}

describe("CE-1 public bundle contract", () => {
	it("registers exact public manifest and resource routes once under v1", () => {
		for (const [procedure, path] of [
			["manifest", "/pisocamp/bundle/manifest"],
			["resource", "/pisocamp/bundle/resources/{sha256}"],
		] as const) {
			const route = pisoCampBundleContract[procedure].get["~orpc"].route
			expect(route).toMatchObject({ method: "GET", path })
			expect(route.spec).toBeTypeOf("function")
			expect(
				(route.spec as (spec: { security?: unknown }) => { security?: unknown })({}).security
			).toEqual([])
			expect(v1Contract.pisocamp.bundle[procedure].get["~orpc"].route).toMatchObject({
				method: "GET",
				path: `/v1${path}`,
			})
		}
	})

	it("keeps the resource digest input strict and lowercase", () => {
		const input = pisoCampBundleContract.resource.get["~orpc"].inputSchema
		const digest = "a".repeat(64)

		expect(parse(input, { sha256: digest })).toEqual({ sha256: digest })
		for (const value of [
			{ sha256: digest.toUpperCase() },
			{ sha256: "a".repeat(63) },
			{ sha256: digest, unknown: true },
		]) {
			expect(() => parse(input, value)).toThrow()
		}
	})
})
