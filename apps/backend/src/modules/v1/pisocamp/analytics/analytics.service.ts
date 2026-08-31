import { Inject, Injectable, InternalServerErrorException, type Provider } from "@nestjs/common"
import { sql } from "drizzle-orm"

import type { DBClient } from "@repo/db/client"
import { analyticsEvents } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

export const ANALYTICS_DATABASE = Symbol("ANALYTICS_DATABASE")

type AnalyticsDatabase = Pick<DBClient, "execute" | "transaction">

export const analyticsDatabaseProvider: Provider = {
	provide: ANALYTICS_DATABASE,
	useValue: db,
}

@Injectable()
export class AnalyticsService {
	constructor(@Inject(ANALYTICS_DATABASE) private readonly database: AnalyticsDatabase) {}

	async ingest(
		input: V1Inputs["pisocamp"]["events"]["ingest"]
	): Promise<V1Outputs["pisocamp"]["events"]["ingest"]> {
		await this.database.transaction(async tx => {
			await tx
				.insert(analyticsEvents)
				.values(input.events.map(event => ({ ...event, occurredAt: new Date(event.occurredAt) })))
				.onConflictDoNothing({ target: analyticsEvents.eventId })
		})

		return { ackedEventIds: input.events.map(event => event.eventId) }
	}

	async moduleEntryToday(
		referenceTime: Date = new Date()
	): Promise<V1Outputs["pisocamp"]["analytics"]["moduleEntryToday"]> {
		const result = await this.database.execute<{
			date: string
			moduleEntryCount: string
		}>(sql`
			with reference_time as (
				select ${referenceTime}::timestamptz as instant
			), day_bounds as (
				select
					(instant at time zone 'Asia/Manila')::date as local_date,
					((instant at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila') as start_at,
					((((instant at time zone 'Asia/Manila')::date + 1)::timestamp) at time zone 'Asia/Manila') as end_at
				from reference_time
			)
			select
				day_bounds.local_date::text as "date",
				count(${analyticsEvents.eventId})::text as "moduleEntryCount"
			from day_bounds
			left join ${analyticsEvents}
				on ${analyticsEvents.eventName} = 'module_entry'
				and ${analyticsEvents.occurredAt} >= day_bounds.start_at
				and ${analyticsEvents.occurredAt} < day_bounds.end_at
			group by day_bounds.local_date
		`)

		const row = result.rows[0]
		if (!row || !/^\d+$/.test(row.moduleEntryCount)) {
			throw new InternalServerErrorException("Analytics aggregate is unavailable")
		}

		const count = BigInt(row.moduleEntryCount)
		if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new InternalServerErrorException("Analytics aggregate exceeds the safe integer range")
		}

		return {
			date: row.date,
			timezone: "Asia/Manila",
			moduleEntryCount: Number(count),
		}
	}
}
