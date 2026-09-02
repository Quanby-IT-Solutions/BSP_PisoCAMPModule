import { Inject, Injectable, UnauthorizedException, type Provider } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { inArray } from "drizzle-orm"

import type { DBClient } from "@repo/db/client"
import { triviaResponses } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { AccountAccessService } from "@/common/rbac/account-access.service"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

export const TRIVIA_DATABASE = Symbol("TRIVIA_DATABASE")

type TriviaDatabase = Pick<DBClient, "transaction">

export const triviaDatabaseProvider: Provider = {
	provide: TRIVIA_DATABASE,
	useValue: db,
}

@Injectable()
export class TriviaService {
	constructor(
		@Inject(TRIVIA_DATABASE) private readonly database: TriviaDatabase,
		private readonly accountAccess: AccountAccessService
	) {}

	/**
	 * Store a batch of responses under one account, idempotently.
	 *
	 * The client owns the `responseId`, so a batch replayed after a dropped
	 * connection collides and does nothing. That is the same shape RF-2 uses,
	 * and it is what lets a device upload first and delete afterwards without
	 * ever counting an answer twice.
	 */
	async ingest(
		accountId: string,
		input: V1Inputs["pisocamp"]["trivia"]["ingest"]
	): Promise<V1Outputs["pisocamp"]["trivia"]["ingest"]> {
		// A deactivated account keeps its rows on the device rather than losing
		// them: nothing is acknowledged, so the client deletes nothing.
		if (!(await this.accountAccess.isActive(accountId)))
			throw new UnauthorizedException("Account is deactivated")

		const responseIds = input.responses.map(response => response.responseId)

		await this.database.transaction(async tx => {
			// An id already held by somebody else is not this account's to claim,
			// and silently dropping it would ack an answer that was never stored.
			const foreign = await tx
				.select({ responseId: triviaResponses.responseId, accountId: triviaResponses.accountId })
				.from(triviaResponses)
				.where(inArray(triviaResponses.responseId, responseIds))

			if (foreign.some(row => row.accountId !== accountId))
				throw new ORPCError("CONFLICT", {
					message: "One or more responses are already recorded for another account",
				})

			await tx
				.insert(triviaResponses)
				.values(
					input.responses.map(response => ({
						...response,
						accountId,
						answeredAt: new Date(response.answeredAt),
					}))
				)
				.onConflictDoNothing({ target: triviaResponses.responseId })
		})

		return { ackedResponseIds: responseIds }
	}
}
