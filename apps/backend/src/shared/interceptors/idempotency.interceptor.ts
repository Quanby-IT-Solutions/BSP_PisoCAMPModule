import {
	Injectable,
	type CallHandler,
	type ExecutionContext,
	type NestInterceptor,
} from "@nestjs/common"
import { and, eq, gt, sql } from "drizzle-orm"
import { firstValueFrom, from, type Observable } from "rxjs"

import { idempotencyKeys } from "@repo/db/schema"

import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import { isDevicePseudoId } from "@/shared/identity/device-pseudo-id"
import {
	resolveVerifiedAccountId,
	type VerifiedSessionRequest,
} from "@/shared/identity/verified-session"

import {
	describeIdempotencyKeyProblem,
	IDEMPOTENCY_TTL_MS,
	validateIdempotencyKey,
} from "./idempotency-key"

/**
 * Shape of the oRPC procedure a `@Implement()` controller method returns.
 *
 * The controller does not return a response — it returns a procedure that the
 * oRPC Nest adapter executes afterwards. Only the fields this interceptor
 * needs are described.
 */
type OrpcProcedure = {
	"~orpc": {
		handler: (options: unknown) => unknown
		[key: string]: unknown
	}
}

function isOrpcProcedure(value: unknown): value is OrpcProcedure {
	return (
		typeof value === "object" &&
		value !== null &&
		"~orpc" in value &&
		typeof (value as OrpcProcedure)["~orpc"]?.handler === "function"
	)
}

async function throwOrpcError(
	code: "BAD_REQUEST" | "UNAUTHORIZED",
	message: string
): Promise<never> {
	const { ORPCError } = await import("@orpc/server")
	throw new ORPCError(code, { message })
}

/**
 * Idempotency for mutating endpoints (AB-3 / F-13, F-39).
 *
 * ## Where the work happens, and why it moved
 *
 * Every mutating route here is an oRPC `@Implement()` handler, and those
 * controller methods return a *procedure*, not a response:
 *
 * ```ts
 * async createRole() {
 *   return implement(v1.rbac.roles.create).handler(async ({ input }) => …)
 * }
 * ```
 *
 * A Nest interceptor wraps the controller method's return value, so it never
 * saw the response — it saw the procedure. The previous version stored that
 * object as JSON and replayed it, which produced a stored `response` of
 * `{"~orpc": {"route": …, "inputSchema": …}}` and a 500 on every replay,
 * because oRPC was handed a plain object where it expected a procedure.
 * Idempotency therefore never worked on any endpoint, todos included.
 *
 * The fix is to wrap the procedure's own handler. Store-and-replay now runs
 * where the real input and the real response exist, while the decorator
 * ergonomics (`@UseInterceptors(IdempotencyInterceptor)`) stay unchanged.
 * Non-oRPC routes keep the plain-observable path.
 *
 * ## Behaviour
 *
 *   - No `Idempotency-Key` header   → bypass, except the consent POST where
 *                                      the key is mandatory.
 *   - Invalid key                   → 400 before the handler runs.
 *   - No resolvable author id       → bypass (auth guard already rejected, or
 *                                      the route is anonymous).
 *   - Unexpired row for this author → return the stored response, skip handler.
 *   - Otherwise                     → run the handler once, persist its
 *                                      response with an expiry.
 *
 * ## Identity scoping
 *
 * Keys are scoped to the author. The table's primary key used to be the key
 * alone, so whoever sent a value first owned it globally and a second user
 * sending the same key was refused as a duplicate — a denial of service
 * against any client using predictable keys. Two users sending the same key
 * are sending two unrelated requests, and both now succeed. The advisory lock
 * is likewise keyed on author *and* key, so one user's traffic cannot
 * serialize another's.
 *
 * ## Race safety
 *
 * Concurrent duplicates are serialized with a transaction-scoped Postgres
 * advisory lock. The first request to acquire it re-checks for a stored row,
 * runs the handler, persists the response, and commits — releasing the lock. A
 * concurrent duplicate blocks, then observes the stored row and returns it
 * without running the handler again.
 *
 * Persistence failures are not swallowed: if the row cannot be stored the
 * transaction rolls back and the error propagates, rather than returning
 * success with no replay record and letting a later retry duplicate the write.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
	constructor(private readonly accountAccessService: AccountAccessService) {}

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		const request = context.switchToHttp().getRequest<VerifiedSessionRequest>()

		const rawKey = request.headers["idempotency-key"]
		const key = Array.isArray(rawKey) ? rawKey[0] : rawKey

		// No idempotency key → normal handling.
		if (!key) {
			return from(this.dispatch(next, undefined, undefined, undefined))
		}

		// Mirror RbacGuard's resolution: session first, direct user reference as fallback.
		const authenticatedAuthorId = await resolveVerifiedAccountId(request)
		const rawDevicePseudoId = request.headers["x-device-pseudo-id"]
		const devicePseudoId = Array.isArray(rawDevicePseudoId)
			? rawDevicePseudoId[0]
			: rawDevicePseudoId
		const authorId =
			authenticatedAuthorId ??
			(isDevicePseudoId(devicePseudoId) ? `guest:${devicePseudoId}` : undefined)

		// No account or valid guest subject → bypass; the route's identity layer handles rejection.
		if (!authorId) {
			return from(this.dispatch(next, key, undefined, authenticatedAuthorId))
		}

		return from(this.dispatch(next, key, authorId, authenticatedAuthorId))
	}

	/**
	 * Decide how this route's response is produced, then apply idempotency.
	 *
	 * Subscribing to `next.handle()` on an oRPC route only *builds* the
	 * procedure — the business handler has not run yet, which is exactly why the
	 * wrapping below is safe. On a plain Nest route the emission is already the
	 * computed response, so store-and-replay is applied to it directly; there
	 * are no such mutating routes in this app today, and the shape is kept only
	 * so the interceptor stays usable if one is added.
	 */
	private async dispatch(
		next: CallHandler,
		key: string | undefined,
		authorId: string | undefined,
		authenticatedAuthorId: string | undefined
	): Promise<unknown> {
		const emitted = await firstValueFrom(next.handle())

		if (isOrpcProcedure(emitted)) {
			return this.wrapProcedure(emitted, key, authorId, authenticatedAuthorId)
		}

		if (!key || !authorId) return emitted
		const problem = validateIdempotencyKey(key)
		if (problem) {
			return throwOrpcError("BAD_REQUEST", describeIdempotencyKeyProblem(problem))
		}
		return this.runWithIdempotency(authorId, key, () => Promise.resolve(emitted))
	}

	/** Clone a procedure with its handler wrapped in the idempotency transaction. */
	private wrapProcedure(
		procedure: OrpcProcedure,
		key: string | undefined,
		authorId: string | undefined,
		authenticatedAuthorId: string | undefined
	): OrpcProcedure {
		const original = procedure["~orpc"].handler
		const route = procedure["~orpc"].route as { method?: string; path?: string } | undefined
		const isConsentRecordRoute = route?.method === "POST" && route.path === "/v1/pisocamp/consent"

		const clone: OrpcProcedure = {
			"~orpc": {
				...procedure["~orpc"],
				handler: async (options: unknown) => {
					if (!key) {
						if (isConsentRecordRoute) {
							return throwOrpcError("BAD_REQUEST", "Idempotency-Key is required")
						}
						return original(options)
					}
					const problem = validateIdempotencyKey(key)
					if (problem) {
						return throwOrpcError("BAD_REQUEST", describeIdempotencyKeyProblem(problem))
					}
					if (isConsentRecordRoute) {
						const input = (options as { input?: { id?: unknown } } | null)?.input
						if (input?.id !== key) {
							return throwOrpcError(
								"BAD_REQUEST",
								"Idempotency-Key must match the consent record id"
							)
						}
						if (
							authenticatedAuthorId &&
							!(await this.accountAccessService.isActive(authenticatedAuthorId))
						) {
							return throwOrpcError("UNAUTHORIZED", "Account is deactivated")
						}
					}
					if (!authorId) return original(options)
					return this.runWithIdempotency(authorId, key, () => Promise.resolve(original(options)))
				},
			},
		}

		// oRPC identifies procedures by prototype as well as by the `~orpc` key.
		Object.setPrototypeOf(clone, Object.getPrototypeOf(procedure) as object)
		return clone
	}

	/**
	 * Replay a stored response, or execute `run` once and store its result.
	 *
	 * Returns the value itself (not an Observable) so it can be awaited from
	 * inside an oRPC handler.
	 */
	private runWithIdempotency<T>(authorId: string, key: string, run: () => Promise<T>): Promise<T> {
		return databaseTransactionContext.transaction(async tx => {
			// Locked on author AND key: keying on the key alone let one user's
			// requests block another's whenever both picked the same value.
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${authorId}:${key}`}))`)

			// Re-check under the lock — a concurrent duplicate that ran first has
			// stored its response by now. Scoped to this author, and only rows that
			// have not expired: an expired row is not a valid replay target, so the
			// request executes fresh.
			const now = new Date()
			const existing = await tx
				.select()
				.from(idempotencyKeys)
				.where(
					and(
						eq(idempotencyKeys.authorId, authorId),
						eq(idempotencyKeys.key, key),
						gt(idempotencyKeys.expiresAt, now)
					)
				)

			if (existing[0]) {
				return existing[0].response as T
			}

			// First request for this key: run the handler exactly once, then persist
			// inside the same transaction. A handler error rejects here and rolls
			// back — nothing is stored, and the client sees the failure.
			const response = await run()

			const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS)

			// Upsert on the composite key: the only row that can conflict is this
			// author's own expired one, which the read above deliberately ignored.
			// Overwriting it is correct — the fresh execution replaces a replay
			// target that had already lapsed.
			await tx
				.insert(idempotencyKeys)
				.values({ key, authorId, response: response as unknown, expiresAt })
				.onConflictDoUpdate({
					target: [idempotencyKeys.authorId, idempotencyKeys.key],
					set: { response: response as unknown, createdAt: now, expiresAt },
				})

			return response
		})
	}
}
