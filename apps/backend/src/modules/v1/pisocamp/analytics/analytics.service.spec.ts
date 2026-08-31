import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"

import { analyticsEvents } from "@repo/db/schema"

import { AnalyticsService } from "./analytics.service"

const firstEvent = {
	schemaVersion: 1 as const,
	eventId: "6bdf8864-f630-46e1-a17f-52354afccf57",
	eventName: "module_entry" as const,
	occurredAt: "2026-08-30T15:59:59.999Z",
	subjectPseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
	sessionId: "8c479891-9c42-4550-b5a7-2ab6059c8a91",
	accountType: "guest" as const,
	screen: "pisocamp_home" as const,
	feature: "module" as const,
	appVersion: "1.0.0",
	osName: "android" as const,
	osVersion: "15",
	deviceCategory: "phone" as const,
	networkState: "online" as const,
	status: "completed" as const,
	properties: { entryPoint: "navigation" as const },
}

const secondEvent = {
	...firstEvent,
	eventId: "2cb43d96-10bc-40df-876f-20590d0e85d2",
	eventName: "content_view" as const,
	occurredAt: "2026-08-30T16:00:00.000Z",
	screen: "currency_detail" as const,
	feature: "currency_education" as const,
	properties: { logicalId: "PHP-1000-2020" },
}

describe("AnalyticsService", () => {
	it("commits one conflict-ignore batch before acknowledging IDs in request order", async () => {
		let releaseCommit!: () => void
		const commitGate = new Promise<void>(resolve => {
			releaseCommit = resolve
		})
		const observed: {
			transactionCalls: number
			table?: unknown
			values?: unknown[]
			conflictTarget?: unknown
		} = { transactionCalls: 0 }
		const transaction = async (work: (tx: unknown) => Promise<unknown>) => {
			observed.transactionCalls += 1
			const tx = {
				insert: (table: unknown) => {
					observed.table = table
					return {
						values: (values: unknown[]) => {
							observed.values = values
							return {
								onConflictDoNothing: async ({ target }: { target: unknown }) => {
									observed.conflictTarget = target
								},
							}
						},
					}
				},
			}
			await work(tx)
			await commitGate
		}
		const service = new AnalyticsService({ transaction } as never)

		let settled = false
		const resultPromise = service.ingest({ events: [firstEvent, secondEvent] }).then(result => {
			settled = true
			return result
		})
		await new Promise(resolve => setImmediate(resolve))

		expect(settled).toBe(false)
		expect(observed).toMatchObject({
			transactionCalls: 1,
			table: analyticsEvents,
			conflictTarget: analyticsEvents.eventId,
			values: [
				{ ...firstEvent, occurredAt: new Date(firstEvent.occurredAt) },
				{ ...secondEvent, occurredAt: new Date(secondEvent.occurredAt) },
			],
		})

		releaseCommit()
		await expect(resultPromise).resolves.toEqual({
			ackedEventIds: [firstEvent.eventId, secondEvent.eventId],
		})
	})

	it("queries one parameterized half-open Asia/Manila occurred-at day", async () => {
		let capturedQuery: SQL | undefined
		const referenceTime = new Date("2026-08-30T16:30:00.000Z")
		const service = new AnalyticsService({
			execute: async (query: SQL) => {
				capturedQuery = query
				return { rows: [{ date: "2026-08-31", moduleEntryCount: "17" }] }
			},
		} as never)

		await expect(service.moduleEntryToday(referenceTime)).resolves.toEqual({
			date: "2026-08-31",
			timezone: "Asia/Manila",
			moduleEntryCount: 17,
		})

		const compiled = new PgDialect().sqlToQuery(capturedQuery!)
		const normalizedSql = compiled.sql.replace(/\s+/g, " ").trim()
		expect(compiled.params).toEqual([referenceTime])
		expect(normalizedSql).toContain("at time zone 'Asia/Manila'")
		expect(normalizedSql).toContain('"analytics_event"."event_name" = \'module_entry\'')
		expect(normalizedSql).toContain('"analytics_event"."occurred_at" >=')
		expect(normalizedSql).toContain('"analytics_event"."occurred_at" <')
	})

	it("refuses a count above JavaScript's safe integer range", async () => {
		const service = new AnalyticsService({
			execute: async () => ({
				rows: [{ date: "2026-08-31", moduleEntryCount: "9007199254740992" }],
			}),
		} as never)

		await expect(
			service.moduleEntryToday(new Date("2026-08-30T16:30:00.000Z"))
		).rejects.toMatchObject({ status: 500 })
	})
})
