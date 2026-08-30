import {
	BundleRepository,
	calculateBundleRetryDelaySeconds,
	sanitizeBundleErrorCode,
} from "./bundle-repository"

function databaseReturning(row: Record<string, unknown>) {
	const limit = jest.fn().mockResolvedValue([row])
	const where = jest.fn().mockReturnValue({ limit })
	const innerJoin = jest.fn().mockReturnValue({ where })
	const from = jest.fn().mockReturnValue({ innerJoin })
	return { select: jest.fn().mockReturnValue({ from }) }
}

describe("bundle repository failure policy", () => {
	it.each([
		["padded payload", { payload: "e30=" }],
		["noncanonical signature", { signature: `${"A".repeat(86)}=` }],
		["invalid key id", { keyId: "Internal Key" }],
	])("rejects a malformed current ready envelope row with %s", async (_label, change) => {
		const row = {
			schemaVersion: 1,
			algorithm: "Ed25519",
			keyId: "ce1-test-v1",
			payload: "e30",
			signature: "A".repeat(86),
			...change,
		}
		const repository = new BundleRepository()

		await expect(
			repository.readCurrentReadyEnvelope(databaseReturning(row) as never)
		).resolves.toBe(null)
	})
	it.each([
		[1, 30],
		[2, 60],
		[7, 1_920],
		[8, 3_600],
		[50, 3_600],
	])("backs off attempt %i for %i seconds with a one-hour cap", (attempt, expected) => {
		expect(calculateBundleRetryDelaySeconds(attempt)).toBe(expected)
	})

	it("maps only allowlisted internal failures to stable codes", () => {
		expect(sanitizeBundleErrorCode(new Error("secret body https://example.test?q=token"))).toBe(
			"bundle_build_failed"
		)
		expect(sanitizeBundleErrorCode({ code: "STORE_CORRUPTION" })).toBe("store_corruption")
		expect(sanitizeBundleErrorCode({ code: "customer_secret_value" })).toBe("bundle_build_failed")
		expect(sanitizeBundleErrorCode({ code: "../../Bad Code!" })).toBe("bundle_build_failed")
	})
})
