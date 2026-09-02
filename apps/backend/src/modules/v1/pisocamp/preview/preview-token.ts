import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"

import {
	PISO_CAMP_PREVIEWABLE_STATUSES,
	type PisoCampPreviewableStatus,
} from "@repo/contracts/pisocamp-preview"

const TOKEN_VERSION = "v1"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PREVIEWABLE = new Set<string>(PISO_CAMP_PREVIEWABLE_STATUSES)

/**
 * Everything the server re-checks when a preview grant comes back.
 *
 * The claims name a *version*, not an item: an item's working version moves on
 * every edit and every transition, so a grant that only named the item would
 * silently start rendering content nobody previewed.
 */
export interface PreviewTokenClaims {
	itemId: string
	versionId: string
	versionNo: number
	status: PisoCampPreviewableStatus
	actorId: string
	/** Epoch milliseconds. */
	expiresAt: number
}

export type PreviewTokenFailure = "malformed" | "bad_signature" | "expired" | "unsupported_version"

export class PreviewTokenError extends Error {
	readonly reason: PreviewTokenFailure

	constructor(reason: PreviewTokenFailure) {
		super(reason)
		this.name = "PreviewTokenError"
		this.reason = reason
	}
}

function encodeSegment(value: object): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function isClaims(value: unknown): value is PreviewTokenClaims {
	if (typeof value !== "object" || value === null) return false
	const claims = value as Record<string, unknown>
	return (
		typeof claims.itemId === "string" &&
		UUID_PATTERN.test(claims.itemId) &&
		typeof claims.versionId === "string" &&
		UUID_PATTERN.test(claims.versionId) &&
		typeof claims.versionNo === "number" &&
		Number.isSafeInteger(claims.versionNo) &&
		claims.versionNo > 0 &&
		typeof claims.status === "string" &&
		PREVIEWABLE.has(claims.status) &&
		typeof claims.actorId === "string" &&
		claims.actorId.length > 0 &&
		claims.actorId.length <= 255 &&
		typeof claims.expiresAt === "number" &&
		Number.isSafeInteger(claims.expiresAt) &&
		claims.expiresAt > 0
	)
}

/**
 * Derive the preview signing key.
 *
 * A dedicated `PISOCAMP_PREVIEW_TOKEN_SECRET` wins when supplied. Otherwise the
 * key is HKDF-derived from the session secret with a preview-specific `info`
 * label, so an existing deployment gains preview without a new mandatory
 * secret while the two keys stay cryptographically independent — a preview
 * grant can never be replayed as a session, or the reverse.
 */
export function derivePreviewTokenKey(input: {
	previewSecret?: string
	authSecret: string
}): Buffer {
	const source = input.previewSecret?.trim()
	if (source) return Buffer.from(source, "utf8")
	return Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(input.authSecret, "utf8"),
			Buffer.alloc(0),
			"pisocamp-preview-token/v1",
			32
		)
	)
}

function signingInput(payloadSegment: string): string {
	return `${TOKEN_VERSION}.${payloadSegment}`
}

export function signPreviewToken(key: Buffer, claims: PreviewTokenClaims): string {
	const payloadSegment = encodeSegment(claims)
	const signature = createHmac("sha256", key)
		.update(signingInput(payloadSegment))
		.digest("base64url")
	return `${TOKEN_VERSION}.${payloadSegment}.${signature}`
}

/**
 * Verify a grant and return its claims.
 *
 * Signature first, then expiry: checking expiry on an unverified payload would
 * let an attacker learn which forged claims are "still fresh".
 */
export function verifyPreviewToken(key: Buffer, token: string, now: Date): PreviewTokenClaims {
	const parts = token.split(".")
	if (parts.length !== 3) throw new PreviewTokenError("malformed")
	const [version, payloadSegment, signature] = parts as [string, string, string]
	if (version !== TOKEN_VERSION) throw new PreviewTokenError("unsupported_version")
	if (!payloadSegment || !signature) throw new PreviewTokenError("malformed")

	const expected = createHmac("sha256", key).update(signingInput(payloadSegment)).digest()
	let presented: Buffer
	try {
		presented = Buffer.from(signature, "base64url")
	} catch {
		throw new PreviewTokenError("malformed")
	}
	if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
		throw new PreviewTokenError("bad_signature")
	}

	let claims: unknown
	try {
		claims = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"))
	} catch {
		throw new PreviewTokenError("malformed")
	}
	if (!isClaims(claims)) throw new PreviewTokenError("malformed")
	if (claims.expiresAt <= now.getTime()) throw new PreviewTokenError("expired")
	return claims
}
