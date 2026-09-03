import { sql } from "drizzle-orm"

import { auditLog, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

const ADA_ID = "sa4-ada"
const BEN_ID = "sa4-ben"

/**
 * SA-4. The viewer is `AuditService.list` with filters, so these tests are
 * about the filters and the paging — the reading of the trail somebody actually
 * does when asking who did what.
 */
describe("SA-4 audit log viewer", () => {
	const service = new AuditService()

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table audit_log, sessions, accounts, users restart identity cascade
		`)
		const now = new Date("2026-09-01T00:00:00.000Z")
		await db.insert(users).values([
			{
				id: ADA_ID,
				name: "Ada Admin",
				email: "ada@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: BEN_ID,
				name: "Ben Admin",
				email: "ben@example.test",
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		])
		await db.insert(auditLog).values([
			{
				domain: "pisocamp",
				action: "account.status.update",
				outcome: "success",
				actorId: ADA_ID,
				targetType: "user",
				targetId: BEN_ID,
				oldValue: { status: "active" },
				newValue: { status: "deactivated" },
				reason: "Left the organisation",
				// 3 September in Manila is the 2nd, 16:00, in UTC.
				createdAt: new Date("2026-09-02T16:30:00.000Z"),
			},
			{
				domain: "rbac",
				action: "permission_denied",
				outcome: "denied",
				actorId: BEN_ID,
				targetType: "handler",
				targetId: "ReportsController.generate",
				newValue: { missingPermissions: ["reports.reports.generate"] },
				createdAt: new Date("2026-09-03T02:00:00.000Z"),
			},
			{
				domain: "pisocamp",
				action: "report.generate",
				outcome: "success",
				actorId: ADA_ID,
				targetType: "report_run",
				targetId: "run-1",
				newValue: { definitionKey: "activity" },
				createdAt: new Date("2026-09-04T02:00:00.000Z"),
			},
		])
	})

	afterAll(async () => {
		await db.$client.end()
	})

	describe("AC1 — entries show who, what, on what, before and after", () => {
		it("carries every field the viewer shows, and resolves the actor", async () => {
			const { entries } = await service.list({ limit: 50 })

			const change = entries.find(entry => entry.action === "account.status.update")
			expect(change).toMatchObject({
				domain: "pisocamp",
				outcome: "success",
				actorId: ADA_ID,
				actorEmail: "ada@example.test",
				targetType: "user",
				targetId: BEN_ID,
				oldValue: { status: "active" },
				newValue: { status: "deactivated" },
				reason: "Left the organisation",
			})
		})

		it("includes permission denials and report generations", async () => {
			const { entries } = await service.list({ limit: 50 })

			// The two the ticket names by name: a refusal nobody can see is not
			// evidence, and a report leaving the building is a thing that happened.
			expect(entries.map(entry => entry.action)).toEqual(
				expect.arrayContaining(["permission_denied", "report.generate"])
			)
		})

		it("returns the newest first", async () => {
			const { entries } = await service.list({ limit: 50 })

			expect(entries.map(entry => entry.action)).toEqual([
				"report.generate",
				"permission_denied",
				"account.status.update",
			])
		})
	})

	describe("AC2 — the filters narrow, and the results page", () => {
		it("narrows by actor", async () => {
			const { entries } = await service.list({ limit: 50, actorId: ADA_ID })

			expect(entries.map(entry => entry.action).sort()).toEqual([
				"account.status.update",
				"report.generate",
			])
		})

		it("narrows by action", async () => {
			const { entries } = await service.list({ limit: 50, action: "permission_denied" })

			expect(entries).toHaveLength(1)
			expect(entries[0]).toMatchObject({ actorId: BEN_ID })
		})

		it("narrows by target type", async () => {
			const { entries } = await service.list({ limit: 50, targetType: "report_run" })

			expect(entries).toHaveLength(1)
			expect(entries[0]).toMatchObject({ action: "report.generate" })
		})

		it("narrows by a range of Manila days, including both ends", async () => {
			const { entries } = await service.list({ limit: 50, from: "2026-09-03", to: "2026-09-03" })

			// One day asked for is that whole day: the 3rd in Manila, which is the
			// 2nd at 16:00 UTC onwards.
			expect(entries.map(entry => entry.action)).toEqual([
				"permission_denied",
				"account.status.update",
			])
		})

		it("combines filters rather than choosing between them", async () => {
			const { entries } = await service.list({
				limit: 50,
				actorId: ADA_ID,
				from: "2026-09-04",
				to: "2026-09-04",
			})

			expect(entries).toHaveLength(1)
			expect(entries[0]).toMatchObject({ action: "report.generate" })
		})

		it("pages without repeating an entry", async () => {
			const first = await service.list({ limit: 2 })
			expect(first.entries).toHaveLength(2)
			expect(first.nextCursor).not.toBeNull()

			const second = await service.list({ limit: 2, before: first.nextCursor! })

			expect(second.entries).toHaveLength(1)
			expect(second.nextCursor).toBeNull()
			const ids = [...first.entries, ...second.entries].map(entry => entry.id)
			expect(new Set(ids).size).toBe(3)
		})

		it("says plainly that a filter matched nothing", async () => {
			const { entries, nextCursor } = await service.list({ limit: 50, action: "never.happened" })

			expect(entries).toEqual([])
			expect(nextCursor).toBeNull()
		})
	})
})
