import { Reflector } from "@nestjs/core"
import { eq, sql } from "drizzle-orm"
import { firstValueFrom, of } from "rxjs"

import {
	auditLog,
	contentItems,
	contentVersions,
	idempotencyKeys,
	relatedLinks,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentService } from "./content.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
}))

const USER_ID = "cm1-task4-idempotency-user"
const KEY = "4874bc49-2a2c-4425-af5a-f4d6d9aad5ec"
const TRIGGER = "cm1_task4_fail_idempotency"
const FUNCTION = "cm1_task4_fail_idempotency_fn"

describe("Content idempotency transaction boundary", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(
			sql`truncate table related_link, content_version, content_item, audit_log, idempotency_keys, users restart identity cascade`
		)
		await db.execute(
			sql`insert into users (id, name, email, email_verified, created_at, updated_at) values (${USER_ID}, 'Editor', 'idempotency@example.test', true, now(), now())`
		)
	})

	afterEach(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql.raw(`drop trigger if exists "${TRIGGER}" on "idempotency_keys"`))
		await db.execute(sql.raw(`drop function if exists "${FUNCTION}"()`))
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.authorId, USER_ID))
		await db.execute(
			sql`truncate table related_link, content_version, content_item, audit_log restart identity cascade`
		)
	})

	it("rolls back item, version, links, and audit when idempotency persistence fails", async () => {
		const service = new ContentService(new AuditService())
		const target = await service.create(
			{
				requestId: "0d5c6aec-3ae1-45d0-8f15-13818be26c12",
				content: {
					contentType: "advisory",
					title: "Existing topic",
					summary: "Baseline",
					body: "Body",
				},
				relatedLinks: [],
			},
			USER_ID
		)
		const baseline = {
			items: await db.select().from(contentItems),
			versions: await db.select().from(contentVersions),
			links: await db.select().from(relatedLinks),
			audits: await db.select().from(auditLog),
		}
		await db.execute(
			sql.raw(
				`create function "${FUNCTION}"() returns trigger language plpgsql as $$ begin raise exception 'forced idempotency failure'; end $$`
			)
		)
		await db.execute(
			sql.raw(
				`create trigger "${TRIGGER}" before insert on "idempotency_keys" for each row execute function "${FUNCTION}"()`
			)
		)
		const reflector = new Reflector()
		jest
			.spyOn(reflector, "getAllAndOverride")
			.mockReturnValue({ requestIdField: "requestId", requireActiveAccount: true })
		const interceptor = new IdempotencyInterceptor(
			{ isActive: async () => true } as never,
			reflector
		)
		const procedure = {
			"~orpc": {
				handler: (_options?: unknown) =>
					service.create(
						{
							requestId: KEY,
							content: {
								contentType: "advisory",
								title: "Atomic",
								summary: "Summary",
								body: "Body",
							},
							relatedLinks: [
								{
									kind: "topic",
									label: "Existing topic",
									targetContentItemId: target.id,
								},
							],
						},
						USER_ID
					),
			},
		}
		const context = {
			getHandler: () => context,
			getClass: () => class ContentMutation {},
			switchToHttp: () => ({
				getRequest: () => ({
					headers: { "idempotency-key": KEY },
					session: { user: { id: USER_ID } },
				}),
			}),
		} as never
		const wrapped = (await firstValueFrom(
			await interceptor.intercept(context, { handle: () => of(procedure) } as never)
		)) as typeof procedure
		await expect(wrapped["~orpc"].handler({ input: { requestId: KEY } } as never)).rejects.toThrow()
		expect(await db.select().from(contentItems)).toEqual(baseline.items)
		expect(await db.select().from(contentVersions)).toEqual(baseline.versions)
		expect(await db.select().from(relatedLinks)).toEqual(baseline.links)
		expect(await db.select().from(auditLog)).toEqual(baseline.audits)
	})
})
