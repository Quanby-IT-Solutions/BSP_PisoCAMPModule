import { APIError } from "better-auth/api"

/**
 * What a deactivated person is told when they try to sign in.
 *
 * It says what happened and who to ask. "Invalid credentials" would send
 * somebody to reset a password that was never the problem, and a bare
 * "forbidden" tells them nothing they can act on.
 */
export const DEACTIVATED_ACCOUNT_MESSAGE =
	"This account has been deactivated. Contact your administrator to restore access."

/**
 * SA-1: a deactivated account may not start a session.
 *
 * Stated once, as a rule over a status rather than as a query, so it can be
 * tested without standing up an auth instance and so the same rule applies
 * however the session came to be created — password, social provider or any
 * later addition.
 */
export async function assertAccountMayStartSession(
	readStatus: (userId: string) => Promise<string | null | undefined>,
	userId: string
): Promise<void> {
	const status = await readStatus(userId)

	if (status === "deactivated") {
		throw new APIError("FORBIDDEN", { message: DEACTIVATED_ACCOUNT_MESSAGE })
	}
}
