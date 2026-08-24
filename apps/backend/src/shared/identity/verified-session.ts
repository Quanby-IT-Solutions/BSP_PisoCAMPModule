import type { IncomingHttpHeaders } from "node:http"

export type VerifiedSessionRequest = {
	headers: IncomingHttpHeaders
	session?: { user?: { id?: string } }
	user?: { id?: string }
}

/** Resolve and attach the verified Better Auth session regardless of global guard ordering. */
export async function resolveVerifiedAccountId(
	request: VerifiedSessionRequest
): Promise<string | undefined> {
	const attached = request.session?.user?.id ?? request.user?.id
	if (attached) return attached

	// Both packages are ESM. Resolve lazily so authenticated requests with an
	// already-attached session do not load the fallback path at all.
	const [{ fromNodeHeaders }, { getAuth }] = await Promise.all([
		import("better-auth/node"),
		import("@repo/auth"),
	])
	const session = await getAuth().api.getSession({ headers: fromNodeHeaders(request.headers) })
	if (!session?.user?.id) return undefined
	request.session = session
	request.user = session.user
	return session.user.id
}
