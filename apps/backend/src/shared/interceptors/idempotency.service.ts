import { Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, eq, gt, sql } from "drizzle-orm"

import { idempotencyKeys } from "@repo/db/schema"

import { databaseTransactionContext } from "@/common/database/database-transaction.context"

import { IDEMPOTENCY_TTL_MS } from "./idempotency-key"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface IdempotentOperation<T extends JsonValue> {
	authorId: string
	key: string
	method: string
	path: string
	input: unknown
	run: () => Promise<T>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function canonicalizeFingerprint(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) return value.map(item => canonicalizeFingerprint(item))

	return Object.fromEntries(
		Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalizeFingerprint(item)])
	)
}

function createRequestFingerprint(operation: Omit<IdempotentOperation<JsonValue>, "run">): string {
	const canonicalRequest = JSON.stringify({
		operation: {
			method: operation.method.toUpperCase(),
			path: operation.path,
		},
		input: canonicalizeFingerprint(operation.input),
	})
	return createHash("sha256").update(canonicalRequest).digest("hex")
}

function invalidJsonResponse(): never {
	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "Idempotent response is not JSON-compatible",
	})
}

function normalizeJsonResponse<T extends JsonValue>(value: T): T {
	const active = new Set<object>()
	const validateAndSort = (candidate: unknown): JsonValue => {
		if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
			return candidate
		}
		if (typeof candidate === "number") {
			if (!Number.isFinite(candidate)) return invalidJsonResponse()
			return candidate
		}
		if (typeof candidate !== "object") return invalidJsonResponse()
		if (active.has(candidate)) return invalidJsonResponse()
		active.add(candidate)
		try {
			if (Array.isArray(candidate)) return candidate.map(item => validateAndSort(item))
			const prototype = Object.getPrototypeOf(candidate) as object | null
			if (prototype !== Object.prototype && prototype !== null) return invalidJsonResponse()
			return Object.fromEntries(
				Object.keys(candidate)
					.sort((left, right) => left.localeCompare(right))
					.map(key => [key, validateAndSort((candidate as Record<string, unknown>)[key])])
			)
		} finally {
			active.delete(candidate)
		}
	}

	const encoded = JSON.stringify(validateAndSort(value))
	if (encoded === undefined) return invalidJsonResponse()
	return JSON.parse(encoded) as T
}

export function requireMatchingRequestId(
	rawKey: string | string[] | undefined,
	requestId: string
): string {
	if (typeof rawKey !== "string") {
		throw new ORPCError("BAD_REQUEST", { message: "Idempotency-Key is required" })
	}
	if (!UUID_PATTERN.test(rawKey)) {
		throw new ORPCError("BAD_REQUEST", { message: "Idempotency-Key must be a UUID" })
	}
	if (rawKey !== requestId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Idempotency-Key must match the request id",
		})
	}
	return rawKey
}

@Injectable()
export class IdempotencyService {
	execute<T extends JsonValue>(operation: IdempotentOperation<T>): Promise<T> {
		const requestFingerprint = createRequestFingerprint(operation)

		return databaseTransactionContext.transaction(async tx => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${`${operation.authorId}:${operation.key}`}))`
			)

			const now = new Date()
			const existing = await tx
				.select()
				.from(idempotencyKeys)
				.where(
					and(
						eq(idempotencyKeys.authorId, operation.authorId),
						eq(idempotencyKeys.key, operation.key),
						gt(idempotencyKeys.expiresAt, now)
					)
				)

			if (existing[0]) {
				if (existing[0].requestFingerprint !== requestFingerprint) {
					throw new ORPCError("CONFLICT", {
						message: "Idempotency-Key was already used for a different request",
					})
				}
				return normalizeJsonResponse(existing[0].response as T)
			}

			const response = normalizeJsonResponse(await operation.run())
			const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS)
			const persistedResponse = response === null ? sql`'null'::jsonb` : response

			await tx
				.insert(idempotencyKeys)
				.values({
					key: operation.key,
					authorId: operation.authorId,
					requestFingerprint,
					response: persistedResponse,
					expiresAt,
				})
				.onConflictDoUpdate({
					target: [idempotencyKeys.authorId, idempotencyKeys.key],
					set: {
						requestFingerprint,
						response: persistedResponse,
						createdAt: now,
						expiresAt,
					},
				})

			return response
		})
	}
}
