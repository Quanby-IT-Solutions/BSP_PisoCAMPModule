import { types as nodeTypes } from "node:util"

/**
 * Request-id sanitisation for the log path (LG-2 / F-37).
 *
 * The redaction policy itself — query-string and structured-field stripping —
 * lives in `@repo/observability`, which is shared with non-backend clients.
 * What stays here is the correlation-id handling, a transport concern of this
 * HTTP server alone.
 */

/**
 * Longest correlation id accepted from a client (LG-2 / F-37).
 *
 * An inbound `X-Request-Id` was taken verbatim: unbounded, logged, and echoed
 * back on the response. That is two problems. A newline or control character
 * forges log lines, since the id is written into structured output that a log
 * reader parses. And an unbounded value reflected in a response header is a
 * cache-poisoning and header-injection surface.
 */
export const MAX_REQUEST_ID_LENGTH = 64

/**
 * Safe charset: what a UUID, ULID or similar correlation id is made of.
 * Deliberately an allowlist — no whitespace, no control characters, nothing
 * that could terminate a header or a log field.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/

const TRUSTED_ERROR_NAMES = new Map<object, string>([
	[Error.prototype, "Error"],
	[TypeError.prototype, "TypeError"],
	[RangeError.prototype, "RangeError"],
	[ReferenceError.prototype, "ReferenceError"],
	[SyntaxError.prototype, "SyntaxError"],
	[URIError.prototype, "URIError"],
	[EvalError.prototype, "EvalError"],
	[AggregateError.prototype, "AggregateError"],
])

const TRUSTED_OPERATIONAL_ERROR_CODES = new Set([
	"EAI_AGAIN",
	"ECONNABORTED",
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"EPIPE",
	"ETIMEDOUT",
	"ERR_STREAM_PREMATURE_CLOSE",
])

/**
 * The inbound id if it is safe to reuse, otherwise null so the caller mints a
 * fresh one. Reusing a client value is what makes distributed tracing work, so
 * it is kept — but only when it cannot forge a log line.
 */
export function sanitizeRequestId(value: unknown): string | null {
	const raw = Array.isArray(value) ? value[0] : value
	if (typeof raw !== "string") return null
	if (raw.length === 0 || raw.length > MAX_REQUEST_ID_LENGTH) return null
	if (!REQUEST_ID_PATTERN.test(raw)) return null
	return raw
}

function trustedErrorName(value: unknown): string | null {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) return null
	try {
		if (!nodeTypes.isNativeError(value)) return null
		return TRUSTED_ERROR_NAMES.get(Object.getPrototypeOf(value) as object) ?? null
	} catch {
		return null
	}
}

/** A fixed built-in error category safe for structured logs and responses. */
export function safeErrorName(value: unknown, fallback = "Error"): string {
	return trustedErrorName(value) ?? fallback
}

/**
 * Preserve only stable diagnostic classification from a request error. Error
 * messages and stacks may contain credentials, paths, SQL, or uploaded data.
 */
export function safeLogError(value: unknown): { type: string; code?: string } {
	const trustedName = trustedErrorName(value)
	const type = trustedName ?? "Error"
	if (
		!trustedName ||
		(typeof value !== "object" && typeof value !== "function") ||
		value === null
	) {
		return { type }
	}
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, "code")
		const code = descriptor && "value" in descriptor ? descriptor.value : undefined
		return typeof code === "string" && TRUSTED_OPERATIONAL_ERROR_CODES.has(code)
			? { type, code }
			: { type }
	} catch {
		return { type }
	}
}
