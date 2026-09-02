import {
	derivePreviewTokenKey,
	PreviewTokenError,
	signPreviewToken,
	verifyPreviewToken,
	type PreviewTokenClaims,
} from "./preview-token"

const AUTH_SECRET = "auth-secret-that-is-long-enough-for-hkdf-derivation"
const key = derivePreviewTokenKey({ authSecret: AUTH_SECRET })
const now = new Date("2026-09-02T00:00:00.000Z")

const claims: PreviewTokenClaims = {
	itemId: "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f",
	versionId: "fd21cf65-807b-4546-a7ed-e803d28568d2",
	versionNo: 3,
	status: "approved",
	actorId: "cm5-approver",
	expiresAt: now.getTime() + 300_000,
}

function reasonOf(work: () => unknown): string {
	try {
		work()
	} catch (error) {
		if (error instanceof PreviewTokenError) return error.reason
		return `unexpected:${String(error)}`
	}
	return "no-error"
}

describe("CM-5 preview token", () => {
	it("round-trips the exact claims it was minted with", () => {
		const token = signPreviewToken(key, claims)

		expect(token.startsWith("v1.")).toBe(true)
		expect(token.split(".")).toHaveLength(3)
		expect(verifyPreviewToken(key, token, now)).toEqual(claims)
	})

	it("rejects a payload edited after signing", () => {
		const token = signPreviewToken(key, claims)
		const [version, payload, signature] = token.split(".") as [string, string, string]
		const tampered = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
			string,
			unknown
		>
		tampered.versionNo = 99
		const forged = `${version}.${Buffer.from(JSON.stringify(tampered), "utf8").toString(
			"base64url"
		)}.${signature}`

		expect(reasonOf(() => verifyPreviewToken(key, forged, now))).toBe("bad_signature")
	})

	it("rejects a signature edited after signing and a truncated signature", () => {
		const token = signPreviewToken(key, claims)
		const [version, payload, signature] = token.split(".") as [string, string, string]
		const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`

		expect(reasonOf(() => verifyPreviewToken(key, `${version}.${payload}.${flipped}`, now))).toBe(
			"bad_signature"
		)
		expect(
			reasonOf(() => verifyPreviewToken(key, `${version}.${payload}.${signature.slice(0, 8)}`, now))
		).toBe("bad_signature")
	})

	it("rejects malformed and unsupported-version envelopes without reading claims", () => {
		expect(reasonOf(() => verifyPreviewToken(key, "v1.only-two", now))).toBe("malformed")
		expect(reasonOf(() => verifyPreviewToken(key, "v2.a.b", now))).toBe("unsupported_version")
		expect(reasonOf(() => verifyPreviewToken(key, "v1..b", now))).toBe("malformed")
	})

	it("expires exactly at the stamped instant, not after it", () => {
		const token = signPreviewToken(key, claims)

		expect(verifyPreviewToken(key, token, new Date(claims.expiresAt - 1))).toEqual(claims)
		expect(reasonOf(() => verifyPreviewToken(key, token, new Date(claims.expiresAt)))).toBe(
			"expired"
		)
	})

	it("refuses a signed token whose claims are structurally invalid", () => {
		for (const invalid of [
			{ ...claims, status: "published" },
			{ ...claims, versionNo: 0 },
			{ ...claims, itemId: "not-a-uuid" },
			{ ...claims, actorId: "" },
		]) {
			const token = signPreviewToken(key, invalid as PreviewTokenClaims)
			expect(reasonOf(() => verifyPreviewToken(key, token, now))).toBe("malformed")
		}
	})

	it("derives a key that is independent of the session secret and of other deployments", () => {
		const other = derivePreviewTokenKey({ authSecret: `${AUTH_SECRET}-other` })
		const explicit = derivePreviewTokenKey({
			previewSecret: "a-dedicated-preview-secret-value-32ch",
			authSecret: AUTH_SECRET,
		})

		expect(key.length).toBe(32)
		expect(key.equals(Buffer.from(AUTH_SECRET, "utf8"))).toBe(false)
		expect(key.equals(other)).toBe(false)
		expect(key.equals(explicit)).toBe(false)
		expect(reasonOf(() => verifyPreviewToken(other, signPreviewToken(key, claims), now))).toBe(
			"bad_signature"
		)
	})

	it("prefers an explicitly supplied secret and ignores surrounding whitespace", () => {
		const secret = "a-dedicated-preview-secret-value-32ch"

		expect(
			derivePreviewTokenKey({ previewSecret: `  ${secret}  `, authSecret: AUTH_SECRET })
		).toEqual(Buffer.from(secret, "utf8"))
		expect(derivePreviewTokenKey({ previewSecret: "   ", authSecret: AUTH_SECRET })).toEqual(key)
	})
})
