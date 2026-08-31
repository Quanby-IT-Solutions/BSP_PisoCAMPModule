import { HttpStatus, type INestApplication } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals"
import { and, eq, inArray } from "drizzle-orm"
import { Pool } from "pg"
import request from "supertest"
import { type App } from "supertest/types"

import {
	analyticsEvents,
	auditLog,
	permissions,
	pisoCampAccountState,
	rolePermissions,
	roles,
	userRoles,
	users,
} from "@repo/db/schema"

import { createApplication } from "../src/bootstrap"
import { db } from "../src/common/database/database.client"
import { AnalyticsService } from "../src/modules/v1/pisocamp/analytics/analytics.service"
import { assertDisposablePostgres } from "../src/test-support/destructive-database.guard"

const PASSWORD = "Task3AnalyticsPassword123!"
const EVENT_ID = "67561bcc-880d-4ac1-a5ce-a4e847f38173"
const SESSION_ID = "54e980be-444d-4df6-b1ca-996517c41d4c"
const PSEUDO_ID = "AbCdEfGhIjKlMnOpQrSt_-"
const PROPERTY_SENTINEL = "private-logical-id-sentinel"
const COOKIE_SENTINEL = "private-analytics-cookie-sentinel"
const EMAIL_SENTINEL = "privacy-email-sentinel@example.invalid"
const NAME_SENTINEL = "Privacy Full Name Sentinel"
const IMAGE_SENTINEL = "data:image/png;base64,cHJpdmFjeS1pbWFnZS1zZW50aW5lbA=="
const TOKEN_SENTINEL = "private-bearer-token-sentinel"
const LOCAL_PATH_SENTINEL = "C:\\private\\analytics-queue\\sentinel"
const RAW_ERROR_SENTINEL = "raw-driver-password-sentinel"
const BODY_LIMIT_BYTES = 512 * 1024
const PERMISSION_NAME = "reports.dashboards.view"
const OWNED_PERMISSION_DESCRIPTION = "AN-1 analytics E2E owned permission"
const OWNED_ROLE_NAME = "AN-1 Analytics E2E Reports Role"
const OWNED_EMAILS = [
	"reports-user@an1-analytics-e2e.test",
	"reports-denied@an1-analytics-e2e.test",
	"reports-deactivated@an1-analytics-e2e.test",
] as const
const expectedDatabaseName = process.env.AN1_EXPECTED_DATABASE_NAME ?? "an1_task3_backend_test"

function moduleEntry(eventId = EVENT_ID) {
	return {
		schemaVersion: 1,
		eventId,
		eventName: "module_entry",
		occurredAt: new Date().toISOString(),
		subjectPseudoId: PSEUDO_ID,
		sessionId: SESSION_ID,
		accountType: "guest",
		screen: "pisocamp_home",
		feature: "module",
		appVersion: "1.0.0",
		osName: "android",
		osVersion: "15",
		deviceCategory: "phone",
		networkState: "online",
		status: "completed",
		properties: { entryPoint: "navigation" },
	}
}

function rawJsonBodyOfSize(byteLength: number): string {
	const prefix = '{"padding":"'
	const suffix = '"}'
	return `${prefix}${"x".repeat(byteLength - Buffer.byteLength(prefix + suffix))}${suffix}`
}

function manilaDate(reference: Date): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Manila",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(reference)
	const value = (name: Intl.DateTimeFormatPartTypes) =>
		parts.find(part => part.type === name)!.value
	return `${value("year")}-${value("month")}-${value("day")}`
}

describe("composed analytics HTTP routes", () => {
	let app: INestApplication<App>
	let permittedCookie: string
	let permittedId: string
	let deniedCookie: string
	let deniedId: string
	let deactivatedCookie: string
	let deactivatedId: string
	let requestIp = 10
	let resourcesClosed = false

	function nextIp(): string {
		requestIp += 1
		return `127.0.0.${requestIp}`
	}

	async function deleteOwnedObservations(userIds: string[]): Promise<void> {
		await db.delete(analyticsEvents).where(eq(analyticsEvents.subjectPseudoId, PSEUDO_ID))
		if (userIds.length > 0) {
			await db.delete(auditLog).where(inArray(auditLog.actorId, userIds))
		}
	}

	async function deleteOwnedFixtures(): Promise<void> {
		await db.transaction(async tx => {
			const ownedUsers = await tx
				.select({ id: users.id })
				.from(users)
				.where(inArray(users.email, OWNED_EMAILS))
			const ownedUserIds = ownedUsers.map(user => user.id)

			await tx.delete(analyticsEvents).where(eq(analyticsEvents.subjectPseudoId, PSEUDO_ID))
			if (ownedUserIds.length > 0) {
				await tx.delete(auditLog).where(inArray(auditLog.actorId, ownedUserIds))
				await tx
					.delete(pisoCampAccountState)
					.where(inArray(pisoCampAccountState.accountId, ownedUserIds))
				await tx.delete(users).where(inArray(users.id, ownedUserIds))
			}
			await tx.delete(roles).where(eq(roles.name, OWNED_ROLE_NAME))
			await tx
				.delete(permissions)
				.where(
					and(
						eq(permissions.name, PERMISSION_NAME),
						eq(permissions.description, OWNED_PERMISSION_DESCRIPTION)
					)
				)
		})
	}

	async function registerAndSignIn(localPart: string): Promise<{ id: string; cookie: string }> {
		const email = `${localPart}@an1-analytics-e2e.test`
		const registration = await request(app.getHttpServer())
			.post("/api/v1/auth/sign-up/email")
			.set("Origin", "http://localhost:3001")
			.send({
				name: `Task 3 ${localPart}`,
				email,
				password: PASSWORD,
			})
		expect(registration.status).toBe(HttpStatus.OK)
		const id = registration.body.user.id as string
		await db.update(users).set({ emailVerified: true }).where(eq(users.id, id))

		const signIn = await request(app.getHttpServer())
			.post("/api/v1/auth/sign-in/email")
			.set("Origin", "http://localhost:3001")
			.send({ email, password: PASSWORD })
		expect(signIn.status).toBe(HttpStatus.OK)
		const cookie = ((signIn.headers["set-cookie"] ?? []) as string[]).join("; ")
		expect(cookie).toContain("better-auth.session_token=")
		return { id, cookie }
	}

	beforeAll(async () => {
		const target = assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		expect(target).toEqual({ host: "127.0.0.1", databaseName: expectedDatabaseName })
		await deleteOwnedFixtures()
		app = (await createApplication()) as INestApplication<App>
		await app.init()

		const permitted = await registerAndSignIn("reports-user")
		permittedId = permitted.id
		permittedCookie = permitted.cookie
		const denied = await registerAndSignIn("reports-denied")
		deniedId = denied.id
		deniedCookie = denied.cookie
		const deactivated = await registerAndSignIn("reports-deactivated")
		deactivatedId = deactivated.id
		deactivatedCookie = deactivated.cookie

		await db
			.insert(permissions)
			.values({ name: PERMISSION_NAME, description: OWNED_PERMISSION_DESCRIPTION })
			.onConflictDoNothing()
		const [permission] = await db
			.select()
			.from(permissions)
			.where(eq(permissions.name, PERMISSION_NAME))
		const [role] = await db
			.insert(roles)
			.values({ name: OWNED_ROLE_NAME, description: "AN-1 analytics E2E reports role" })
			.returning()
		await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id })
		await db.insert(userRoles).values([
			{ userId: permittedId, roleId: role!.id },
			{ userId: deactivatedId, roleId: role!.id },
		])
		await db.insert(pisoCampAccountState).values({
			accountId: deactivatedId,
			status: "deactivated",
			reason: "Task 3 composed ordering fixture",
		})
	})

	beforeEach(async () => {
		await deleteOwnedObservations([permittedId, deniedId, deactivatedId])
	})

	afterAll(async () => {
		if (!resourcesClosed) {
			try {
				await deleteOwnedFixtures()
			} finally {
				await app?.close()
				await db.$client.end()
			}
		}
	})

	it("accepts anonymous ingestion, rejects strict invalid bodies, and replays immutably", async () => {
		const server = app.getHttpServer()
		const input = { events: [moduleEntry()] }
		const first = await request(server)
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.send(input)
		expect(first.status).toBe(HttpStatus.OK)
		expect(first.body).toEqual({ ackedEventIds: [EVENT_ID] })

		const replay = await request(server)
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.send({
				events: [{ ...input.events[0], properties: { entryPoint: "deep_link" } }],
			})
		expect(replay.status).toBe(HttpStatus.OK)
		expect(replay.body).toEqual(first.body)
		const rows = await db
			.select()
			.from(analyticsEvents)
			.where(eq(analyticsEvents.eventId, EVENT_ID))
		expect(rows).toHaveLength(1)
		expect(rows[0]?.properties).toEqual({ entryPoint: "navigation" })

		await request(server)
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.send({ events: [moduleEntry(), moduleEntry()] })
			.expect(HttpStatus.BAD_REQUEST)
	})

	it("accepts the closed catalog at its structural maxima below 512 KiB", async () => {
		const events = Array.from({ length: 100 }, () => ({
			...moduleEntry(randomUUID()),
			sessionId: randomUUID(),
			eventName: "content_view",
			screen: "currency_detail",
			feature: "currency_education",
			appVersion: "ࠀ".repeat(64),
			osVersion: "ࠀ".repeat(96),
			properties: { logicalId: "ࠀ".repeat(128) },
		}))
		const body = JSON.stringify({ events })
		expect(Buffer.byteLength(body)).toBeGreaterThan(100 * 1024)
		expect(Buffer.byteLength(body)).toBeLessThan(BODY_LIMIT_BYTES)

		const response = await request(app.getHttpServer())
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.set("Content-Type", "application/json")
			.send(body)
		expect(response.status).toBe(HttpStatus.OK)
		expect(response.body.ackedEventIds).toEqual(events.map(event => event.eventId))
	})

	it("parses a raw body just below 512 KiB and rejects one just above it", async () => {
		const below = rawJsonBodyOfSize(BODY_LIMIT_BYTES - 1)
		const above = rawJsonBodyOfSize(BODY_LIMIT_BYTES + 1)
		expect(Buffer.byteLength(below)).toBe(BODY_LIMIT_BYTES - 1)
		expect(Buffer.byteLength(above)).toBe(BODY_LIMIT_BYTES + 1)

		await request(app.getHttpServer())
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.set("Content-Type", "application/json")
			.send(below)
			.expect(HttpStatus.BAD_REQUEST)
		await request(app.getHttpServer())
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.set("Content-Type", "application/json")
			.send(above)
			.expect(HttpStatus.PAYLOAD_TOO_LARGE)
	})

	it("returns the exact authenticated summary without identity or cookies", async () => {
		const occurredAt = new Date()
		const ingestion = await request(app.getHttpServer())
			.post("/api/v1/pisocamp/events")
			.set("X-Forwarded-For", nextIp())
			.send({ events: [{ ...moduleEntry(), occurredAt: occurredAt.toISOString() }] })
		expect(ingestion.status).toBe(HttpStatus.OK)

		const response = await request(app.getHttpServer())
			.get("/api/v1/admin/pisocamp/analytics/module-entry-today")
			.set("Cookie", permittedCookie)
		expect(response.status).toBe(HttpStatus.OK)
		expect(response.body).toEqual({
			date: manilaDate(occurredAt),
			timezone: "Asia/Manila",
			moduleEntryCount: 1,
		})
		expect(JSON.stringify(response.body)).not.toContain(permittedId)
		expect(JSON.stringify(response.body)).not.toContain("reports-user@an1-analytics-e2e.test")
		expect(JSON.stringify(response.body)).not.toContain("better-auth.session_token")
		expect(response.headers["set-cookie"]).toBeUndefined()
	})

	it("denies a real session without permission and stores exactly one denial audit", async () => {
		const response = await request(app.getHttpServer())
			.get("/api/v1/admin/pisocamp/analytics/module-entry-today")
			.set("Cookie", deniedCookie)
		expect(response.status).toBe(HttpStatus.FORBIDDEN)

		const denials = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.actorId, deniedId), eq(auditLog.action, "permission_denied")))
		expect(denials).toHaveLength(1)
		expect(denials[0]).toMatchObject({
			domain: "rbac",
			outcome: "denied",
			targetType: "handler",
			targetId: "AnalyticsController.moduleEntryToday",
			newValue: {
				requiredPermissions: ["reports.dashboards.view"],
				missingPermissions: ["reports.dashboards.view"],
			},
		})
	})

	it("rejects an unauthenticated summary before permission resolution or audit", async () => {
		const response = await request(app.getHttpServer()).get(
			"/api/v1/admin/pisocamp/analytics/module-entry-today"
		)
		expect(response.status).toBe(HttpStatus.UNAUTHORIZED)
		expect(
			await db
				.select()
				.from(auditLog)
				.where(inArray(auditLog.actorId, [permittedId, deniedId, deactivatedId]))
		).toHaveLength(0)
	})

	it("rejects a deactivated permission holder before grant or denial audit", async () => {
		const response = await request(app.getHttpServer())
			.get("/api/v1/admin/pisocamp/analytics/module-entry-today")
			.set("Cookie", deactivatedCookie)
		expect(response.status).toBe(HttpStatus.UNAUTHORIZED)
		expect(
			await db
				.select()
				.from(auditLog)
				.where(inArray(auditLog.actorId, [permittedId, deniedId, deactivatedId]))
		).toHaveLength(0)
	})

	it("keeps analytics payloads, credentials, and raw failures out of captured Pino output", async () => {
		const service = app.get(AnalyticsService)
		const originalIngest = service.ingest.bind(service)
		const capturedWrites: string[] = []
		const stdoutWrite = jest.spyOn(process.stdout, "write").mockImplementation(((
			chunk: string | Uint8Array
		) => {
			capturedWrites.push(String(chunk))
			return true
		}) as typeof process.stdout.write)
		try {
			const rejected = await request(app.getHttpServer())
				.post("/api/v1/pisocamp/events")
				.set("X-Forwarded-For", nextIp())
				.set("Cookie", `better-auth.session_token=${COOKIE_SENTINEL}`)
				.send({
					events: [
						{
							...moduleEntry(randomUUID()),
							eventName: "content_view",
							screen: "currency_detail",
							feature: "currency_education",
							properties: {
								logicalId: PROPERTY_SENTINEL,
								email: EMAIL_SENTINEL,
								fullName: NAME_SENTINEL,
								rawImage: IMAGE_SENTINEL,
								authorization: TOKEN_SENTINEL,
								localPath: LOCAL_PATH_SENTINEL,
							},
						},
					],
				})
			expect(rejected.status).toBe(HttpStatus.BAD_REQUEST)
			const rejectedBody = JSON.stringify(rejected.body)
			for (const forbidden of [
				EMAIL_SENTINEL,
				NAME_SENTINEL,
				IMAGE_SENTINEL,
				TOKEN_SENTINEL,
				LOCAL_PATH_SENTINEL,
			]) {
				expect(rejectedBody).not.toContain(forbidden)
			}

			await request(app.getHttpServer())
				.post("/api/v1/pisocamp/events")
				.set("X-Forwarded-For", nextIp())
				.set("Cookie", `better-auth.session_token=${COOKIE_SENTINEL}`)
				.send({
					events: [
						{
							...moduleEntry(),
							eventName: "content_view",
							screen: "currency_detail",
							feature: "currency_education",
							properties: { logicalId: PROPERTY_SENTINEL },
						},
					],
				})
				.expect(HttpStatus.OK)

			service.ingest = async () => {
				throw new Error(RAW_ERROR_SENTINEL)
			}
			const failure = await request(app.getHttpServer())
				.post("/api/v1/pisocamp/events")
				.set("X-Forwarded-For", nextIp())
				.send({ events: [moduleEntry(randomUUID())] })
			expect(failure.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
			await new Promise(resolve => setImmediate(resolve))

			expect(JSON.stringify(failure.body)).not.toContain(RAW_ERROR_SENTINEL)
			const output = capturedWrites.join("")
			expect(output).toContain("Unexpected analytics operation failure")
			for (const forbidden of [
				EVENT_ID,
				SESSION_ID,
				PSEUDO_ID,
				PROPERTY_SENTINEL,
				COOKIE_SENTINEL,
				EMAIL_SENTINEL,
				NAME_SENTINEL,
				IMAGE_SENTINEL,
				TOKEN_SENTINEL,
				LOCAL_PATH_SENTINEL,
				RAW_ERROR_SENTINEL,
			]) {
				expect(output).not.toContain(forbidden)
			}
		} finally {
			service.ingest = originalIngest
			stdoutWrite.mockRestore()
		}
	})

	it("releases every application database connection on shutdown", async () => {
		await deleteOwnedFixtures()
		await app.close()
		await db.$client.end()
		resourcesClosed = true

		const inspector = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
		try {
			const result = await inspector.query<{ connectionCount: string }>(`
				select count(*)::text as "connectionCount"
				from pg_stat_activity
				where datname = current_database() and pid <> pg_backend_pid()
			`)
			expect(result.rows[0]?.connectionCount).toBe("0")
		} finally {
			await inspector.end()
		}
	})
})
