import { safeErrorName, safeLogError } from "./log-redaction"

describe("safe error classification", () => {
	it.each([
		["undefined", undefined],
		["null", null],
		["string", "TypeError"],
		["number", 1],
		["symbol", Symbol("private-task7")],
		["function", () => undefined],
		["prototype-less object", Object.create(null)],
	] as const)("totally classifies %s with a fixed fallback", (_case, value) => {
		expect(() => safeErrorName(value)).not.toThrow()
		expect(() => safeLogError(value)).not.toThrow()
		expect(safeErrorName(value)).toBe("Error")
		expect(safeLogError(value)).toEqual({ type: "Error" })
	})

	it("does not execute throwing constructor or code getters", () => {
		const value = {}
		Object.defineProperties(value, {
			constructor: {
				get: () => {
					throw new Error("private-task7-constructor-getter")
				},
			},
			code: {
				get: () => {
					throw new Error("private-task7-code-getter")
				},
			},
		})

		expect(() => safeErrorName(value)).not.toThrow()
		expect(() => safeLogError(value)).not.toThrow()
		expect(safeErrorName(value)).toBe("Error")
		expect(safeLogError(value)).toEqual({ type: "Error" })
	})

	it.each([
		[
			"hostile prototype trap",
			new Proxy(new Error("private-task7-proxy"), {
				getPrototypeOf: () => {
					throw new Error("private-task7-prototype-trap")
				},
				get: () => {
					throw new Error("private-task7-get-trap")
				},
				getOwnPropertyDescriptor: () => {
					throw new Error("private-task7-descriptor-trap")
				},
			}),
		],
		[
			"revoked proxy",
			(() => {
				const proxy = Proxy.revocable(new TypeError("private-task7-revoked"), {})
				proxy.revoke()
				return proxy.proxy
			})(),
		],
		[
			"hostile own-descriptor trap",
			new Proxy(Object.assign(new Error("private-task7-descriptor"), { code: "ECONNRESET" }), {
				getOwnPropertyDescriptor: () => {
					throw new Error("private-task7-descriptor-trap")
				},
			}),
		],
	] as const)("falls back without throwing for a %s", (_case, value) => {
		expect(() => safeErrorName(value)).not.toThrow()
		expect(() => safeLogError(value)).not.toThrow()
		expect(safeErrorName(value)).toBe("Error")
		expect(safeLogError(value)).toEqual({ type: "Error" })
	})

	it("does not trust syntactically safe spoofed constructor names or codes", () => {
		const spoof = {
			constructor: { name: "TypeError" },
			code: "ECONNRESET",
		}
		const safeLookingCode = Object.assign(new Error("private-task7-safe-looking"), {
			code: "SAFE_LOOKING_CODE",
		})
		class PrivateTask7Error extends Error {}

		expect(safeErrorName(spoof)).toBe("Error")
		expect(safeLogError(spoof)).toEqual({ type: "Error" })
		expect(safeLogError(safeLookingCode)).toEqual({ type: "Error" })
		expect(safeErrorName(new PrivateTask7Error())).toBe("Error")
	})

	it("does not trust a proxy that wraps a built-in error and allowlisted code", () => {
		const proxy = new Proxy(
			Object.assign(new TypeError("private-task7-transparent-proxy"), { code: "ECONNRESET" }),
			{}
		)

		expect(safeErrorName(proxy)).toBe("Error")
		expect(safeLogError(proxy)).toEqual({ type: "Error" })
	})

	it.each([
		["Error", new Error(), "Error"],
		["TypeError", new TypeError(), "TypeError"],
		["RangeError", new RangeError(), "RangeError"],
		["ReferenceError", new ReferenceError(), "ReferenceError"],
		["SyntaxError", new SyntaxError(), "SyntaxError"],
		["URIError", new URIError(), "URIError"],
		["EvalError", new EvalError(), "EvalError"],
		["AggregateError", new AggregateError([]), "AggregateError"],
	] as const)("retains the trusted built-in %s category", (_case, error, expected) => {
		expect(safeErrorName(error)).toBe(expected)
	})

	it("retains only an allowlisted own data-descriptor operational code", () => {
		const connectionReset = Object.assign(new Error("private-task7-network-message"), {
			code: "ECONNRESET",
		})
		const inheritedCode = Object.create(
			Object.assign(new Error("private-task7-inherited-code"), { code: "ECONNRESET" })
		) as Error
		const getterError = new Error("private-task7-code-getter")
		Object.defineProperty(getterError, "code", {
			get: () => {
				throw new Error("private-task7-code-getter-executed")
			},
		})

		expect(safeLogError(connectionReset)).toEqual({ type: "Error", code: "ECONNRESET" })
		expect(safeLogError(inheritedCode)).toEqual({ type: "Error" })
		expect(() => safeLogError(getterError)).not.toThrow()
		expect(safeLogError(getterError)).toEqual({ type: "Error" })
	})
})
