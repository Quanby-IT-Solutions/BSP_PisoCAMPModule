import { and, eq, sql } from "drizzle-orm"

import { analyticsEvents } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { AnalyticsService } from "./analytics.service"

const expectedDatabaseName = process.env.AN1_EXPECTED_DATABASE_NAME ?? "an1_task3_backend_test"

const baseEvent = {
	schemaVersion: 1 as const,
	eventId: "82d96f8f-6c7f-4675-b4b5-62d73cd8b4bb",
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

describe("AnalyticsService PostgreSQL idempotency", () => {
	beforeAll(async () => {
		const target = assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		expect(target).toEqual({ host: "127.0.0.1", databaseName: expectedDatabaseName })
		const identity = await db.execute<{ databaseName: string }>(
			sql`select current_database() as "databaseName"`
		)
		expect(identity.rows[0]).toEqual({ databaseName: expectedDatabaseName })
	})

	beforeEach(async () => {
		await db.delete(analyticsEvents)
	})

	afterAll(async () => {
		await db.delete(analyticsEvents)
		await db.$client.end()
	})

	it("replays a batch with the same acknowledgement and one immutable row per ID", async () => {
		const service = new AnalyticsService(db)
		const second = {
			...baseEvent,
			eventId: "74f6f152-3404-4fd5-8409-763c4c2d26d7",
			occurredAt: "2026-08-30T16:00:00.000Z",
		}
		const input = { events: [baseEvent, second] }

		const first = await service.ingest(input)
		const replay = await service.ingest(input)

		expect(replay).toEqual(first)
		expect(first.ackedEventIds).toEqual([baseEvent.eventId, second.eventId])
		const rows = await db
			.select()
			.from(analyticsEvents)
			.where(
				and(
					eq(analyticsEvents.subjectPseudoId, baseEvent.subjectPseudoId),
					eq(analyticsEvents.sessionId, baseEvent.sessionId)
				)
			)
		expect(rows).toHaveLength(2)
	})

	it("serializes concurrent same-ID submissions through the primary-key authority", async () => {
		const services = [new AnalyticsService(db), new AnalyticsService(db)]

		const acknowledgements = await Promise.all(
			services.map(service => service.ingest({ events: [baseEvent] }))
		)

		expect(acknowledgements).toEqual([
			{ ackedEventIds: [baseEvent.eventId] },
			{ ackedEventIds: [baseEvent.eventId] },
		])
		const rows = await db
			.select()
			.from(analyticsEvents)
			.where(eq(analyticsEvents.eventId, baseEvent.eventId))
		expect(rows).toHaveLength(1)
	})

	it("keeps the committed row unchanged when the first response is lost and properties change", async () => {
		const service = new AnalyticsService(db)
		await service.ingest({ events: [baseEvent] })

		const resend = await service.ingest({
			events: [{ ...baseEvent, properties: { entryPoint: "deep_link" as const } }],
		})

		expect(resend).toEqual({ ackedEventIds: [baseEvent.eventId] })
		const [stored] = await db
			.select()
			.from(analyticsEvents)
			.where(eq(analyticsEvents.eventId, baseEvent.eventId))
		expect(stored?.properties).toEqual({ entryPoint: "navigation" })
		expect(stored?.receivedAt).toBeInstanceOf(Date)
	})
})
