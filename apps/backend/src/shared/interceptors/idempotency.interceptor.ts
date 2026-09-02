import {
	Injectable,
	type CallHandler,
	type ExecutionContext,
	type NestInterceptor,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { firstValueFrom, from, type Observable } from "rxjs"

import { AccountAccessService } from "@/common/rbac/account-access.service"
import {
	IDEMPOTENCY_REQUIREMENT_KEY,
	type IdempotencyRequirement,
} from "@/shared/decorators/require-idempotency.decorator"
import { isDevicePseudoId } from "@/shared/identity/device-pseudo-id"
import {
	resolveVerifiedAccountId,
	type VerifiedSessionRequest,
} from "@/shared/identity/verified-session"

import { describeIdempotencyKeyProblem, validateIdempotencyKey } from "./idempotency-key"
import { IdempotencyService, requireMatchingRequestId, type JsonValue } from "./idempotency.service"

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
		route?: unknown
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
	code: "BAD_REQUEST" | "CONFLICT" | "UNAUTHORIZED",
	message: string
): Promise<never> {
	const { ORPCError } = await import("@orpc/server")
	throw new ORPCError(code, { message })
}

type RequestOperation = { method: string; path: string }

function procedureOperation(procedure: OrpcProcedure): RequestOperation {
	const route = procedure["~orpc"].route
	if (typeof route === "object" && route !== null) {
		const { method, path } = route as { method?: unknown; path?: unknown }
		if (typeof method === "string" && typeof path === "string") return { method, path }
	}
	return { method: "ORPC", path: "unknown" }
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
 *   - No `Idempotency-Key` header   → bypass unless route metadata makes the
 *                                      key mandatory.
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
	constructor(
		private readonly accountAccessService: AccountAccessService,
		private readonly reflector: Reflector,
		private readonly idempotencyService: IdempotencyService
	) {}

	async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
		const request = context.switchToHttp().getRequest<VerifiedSessionRequest>()
		const httpRequest = request as VerifiedSessionRequest & {
			body?: unknown
			method?: string
			originalUrl?: string
			route?: { path?: string }
			url?: string
		}
		const plainOperation = {
			method: httpRequest.method ?? "NEST",
			path:
				httpRequest.route?.path ??
				httpRequest.originalUrl ??
				httpRequest.url ??
				`${context.getClass().name}.${context.getHandler().name}`,
		}

		const rawKey = request.headers["idempotency-key"]
		const key = Array.isArray(rawKey) ? rawKey[0] : rawKey
		const requirement = this.reflector.getAllAndOverride<IdempotencyRequirement>(
			IDEMPOTENCY_REQUIREMENT_KEY,
			[context.getHandler(), context.getClass()]
		)

		// Missing keys bypass optional routes; metadata-backed routes reject in
		// the wrapped oRPC handler, where the validated request input is available.
		if (!key) {
			return from(
				this.dispatch(
					next,
					rawKey,
					undefined,
					undefined,
					undefined,
					requirement,
					plainOperation,
					httpRequest.body
				)
			)
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
			return from(
				this.dispatch(
					next,
					rawKey,
					key,
					undefined,
					authenticatedAuthorId,
					requirement,
					plainOperation,
					httpRequest.body
				)
			)
		}

		return from(
			this.dispatch(
				next,
				rawKey,
				key,
				authorId,
				authenticatedAuthorId,
				requirement,
				plainOperation,
				httpRequest.body
			)
		)
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
		rawKey: string | string[] | undefined,
		key: string | undefined,
		authorId: string | undefined,
		authenticatedAuthorId: string | undefined,
		requirement: IdempotencyRequirement | undefined,
		plainOperation: RequestOperation,
		plainInput: unknown
	): Promise<unknown> {
		const emitted = await firstValueFrom(next.handle())

		if (isOrpcProcedure(emitted)) {
			return this.wrapProcedure(emitted, rawKey, key, authorId, authenticatedAuthorId, requirement)
		}

		if (!key || !authorId) return emitted
		const problem = validateIdempotencyKey(key)
		if (problem) {
			return throwOrpcError("BAD_REQUEST", describeIdempotencyKeyProblem(problem))
		}
		return this.idempotencyService.execute({
			authorId,
			key,
			method: plainOperation.method,
			path: plainOperation.path,
			input: plainInput,
			run: async () => (await Promise.resolve(emitted)) as JsonValue,
		})
	}

	/** Clone a procedure with its handler wrapped in the idempotency transaction. */
	private wrapProcedure(
		procedure: OrpcProcedure,
		rawKey: string | string[] | undefined,
		key: string | undefined,
		authorId: string | undefined,
		authenticatedAuthorId: string | undefined,
		requirement: IdempotencyRequirement | undefined
	): OrpcProcedure {
		const original = procedure["~orpc"].handler
		const operation = procedureOperation(procedure)

		const clone: OrpcProcedure = {
			"~orpc": {
				...procedure["~orpc"],
				handler: async (options: unknown) => {
					if (!key) {
						if (requirement) {
							const input = (options as { input?: Record<string, unknown> } | null)?.input
							requireMatchingRequestId(rawKey, String(input?.[requirement.requestIdField] ?? ""))
						}
						return original(options)
					}
					const problem = validateIdempotencyKey(key)
					if (problem) {
						return throwOrpcError("BAD_REQUEST", describeIdempotencyKeyProblem(problem))
					}
					if (requirement) {
						const input = (options as { input?: Record<string, unknown> } | null)?.input
						requireMatchingRequestId(rawKey, String(input?.[requirement.requestIdField] ?? ""))
						if (
							requirement.requireActiveAccount &&
							authenticatedAuthorId &&
							!(await this.accountAccessService.isActive(authenticatedAuthorId))
						) {
							return throwOrpcError("UNAUTHORIZED", "Account is deactivated")
						}
					}
					if (!authorId) return original(options)
					const input = (options as { input?: unknown } | null)?.input
					return this.idempotencyService.execute({
						authorId,
						key,
						method: operation.method,
						path: operation.path,
						input,
						run: async () => (await Promise.resolve(original(options))) as JsonValue,
					})
				},
			},
		}

		// oRPC identifies procedures by prototype as well as by the `~orpc` key.
		Object.setPrototypeOf(clone, Object.getPrototypeOf(procedure) as object)
		return clone
	}
}
