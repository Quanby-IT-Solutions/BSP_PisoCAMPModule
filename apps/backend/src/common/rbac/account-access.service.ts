import { Injectable } from "@nestjs/common"
import { eq } from "drizzle-orm"

import { pisoCampAccountState } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

@Injectable()
export class AccountAccessService {
	async isActive(accountId: string): Promise<boolean> {
		const [state] = await db
			.select({ status: pisoCampAccountState.status })
			.from(pisoCampAccountState)
			.where(eq(pisoCampAccountState.accountId, accountId))

		return !state || state.status === "active"
	}
}
