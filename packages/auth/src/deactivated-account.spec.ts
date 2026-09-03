import { describe, expect, it, vi } from "vitest"

import {
	assertAccountMayStartSession,
	DEACTIVATED_ACCOUNT_MESSAGE,
} from "./deactivated-account.js"

describe("assertAccountMayStartSession", () => {
	it("lets an active account start a session", async () => {
		await expect(
			assertAccountMayStartSession(async () => "active", "user-1")
		).resolves.toBeUndefined()
	})

	it("lets an account nobody has ever managed start a session", async () => {
		// No row is not "unknown, refuse": it is an account nothing has been
		// done to, and refusing those would lock out every ordinary user.
		await expect(
			assertAccountMayStartSession(async () => null, "user-1")
		).resolves.toBeUndefined()
		await expect(
			assertAccountMayStartSession(async () => undefined, "user-1")
		).resolves.toBeUndefined()
	})

	it("refuses a deactivated account, and says what to do about it", async () => {
		await expect(
			assertAccountMayStartSession(async () => "deactivated", "user-1")
		).rejects.toMatchObject({ message: DEACTIVATED_ACCOUNT_MESSAGE })
	})

	it("asks about the account the session is being created for", async () => {
		const readStatus = vi.fn(async () => "active")

		await assertAccountMayStartSession(readStatus, "user-42")

		expect(readStatus).toHaveBeenCalledWith("user-42")
	})
})
