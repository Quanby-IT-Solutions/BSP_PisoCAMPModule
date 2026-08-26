import { type INestApplication } from "@nestjs/common"
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals"
import { and, eq, sql } from "drizzle-orm"
import request from "supertest"
import { type App } from "supertest/types"

import {
	auditLog,
	permissions,
	pisoCampAccountState,
	rolePermissions,
	roles,
	userRoles,
} from "@repo/db/schema"

import { createApplication } from "../src/bootstrap"
import { db } from "../src/common/database/database.client"
import { assertDisposablePostgres } from "../src/test-support/destructive-database.guard"

const PASSWORD = "Task4ReviewPassword123!"
const CREATE_KEY = "f6d02962-8dde-4968-bb42-744fa9331378"
const UPDATE_KEY = "eac08219-f515-4641-8d0d-6672847bbbc1"

type Identity = { id: string; cookie: string }

describe("composed v1 Piso CAMP content routes", () => {
	let app: INestApplication<App>
	let permitted: Identity
	let missingPermission: Identity

	async function register(localPart: string): Promise<Identity> {
		const response = await request(app.getHttpServer())
			.post("/api/v1/auth/sign-up/email")
			.set("Origin", "http://localhost:3001")
			.send({
				name: `Task 4 ${localPart}`,
				email: `${localPart}@task4.test`,
				password: PASSWORD,
			})
		expect(response.status).toBe(200)
		const cookie = ((response.headers["set-cookie"] ?? []) as string[]).join("; ")
		expect(cookie).toContain("better-auth.session_token=")
		return { id: response.body.user.id as string, cookie }
	}

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table related_link, content_version, content_item, audit_log,
			idempotency_keys, role_permissions, user_roles, permissions, roles,
			pisocamp_account_state, sessions, accounts, users restart identity cascade
		`)
		app = (await createApplication()) as INestApplication<App>
		await app.init()
		permitted = await register("content-permitted")
		missingPermission = await register("content-missing")

		const [permission] = await db
			.insert(permissions)
			.values({ name: "content.items.edit", description: "Task 4 content access" })
			.returning()
		const [role] = await db
			.insert(roles)
			.values({ name: "Task 4 Content Editor", description: "Task-owned e2e role" })
			.returning()
		await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: permission!.id })
		await db.insert(userRoles).values({ userId: permitted.id, roleId: role!.id })
	})

	afterAll(async () => {
		await app?.close()
	})

	it("enforces auth, RBAC, idempotency, active replay, and all four real content procedures", async () => {
		const server = app.getHttpServer()
		await request(server).get("/api/v1/admin/pisocamp/content?page=1&limit=20").expect(401)

		await request(server)
			.get("/api/v1/admin/pisocamp/content?page=1&limit=20")
			.set("Cookie", missingPermission.cookie)
			.expect(403)
		const denials = await db
			.select()
			.from(auditLog)
			.where(
				and(eq(auditLog.actorId, missingPermission.id), eq(auditLog.action, "permission_denied"))
			)
		expect(denials).toHaveLength(1)
		expect(denials[0]).toMatchObject({
			outcome: "denied",
			targetType: "handler",
			targetId: "ContentController.listContent",
		})

		const createBody = {
			requestId: CREATE_KEY,
			content: {
				contentType: "advisory",
				title: "Composed route advisory",
				summary: "Real v1 route",
				body: "Body",
			},
			relatedLinks: [],
		}
		const created = await request(server)
			.post("/api/v1/admin/pisocamp/content")
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", CREATE_KEY)
			.send(createBody)
			.expect(200)
		expect(created.body).toMatchObject({
			contentType: "advisory",
			status: "draft",
			currentVersion: { versionNo: 1, status: "draft" },
			creator: { id: permitted.id },
		})

		const listed = await request(server)
			.get("/api/v1/admin/pisocamp/content?page=1&limit=20")
			.set("Cookie", permitted.cookie)
			.expect(200)
		expect(listed.body.total).toBe(1)
		expect(listed.body.items[0].id).toBe(created.body.id)

		const detail = await request(server)
			.get(`/api/v1/admin/pisocamp/content/${created.body.id}`)
			.set("Cookie", permitted.cookie)
			.expect(200)
		expect(detail.body.id).toBe(created.body.id)

		const updated = await request(server)
			.put(`/api/v1/admin/pisocamp/content/${created.body.id}`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", UPDATE_KEY)
			.send({
				itemId: created.body.id,
				requestId: UPDATE_KEY,
				expectedVersionNo: 1,
				content: { ...createBody.content, title: "Edited through composed route" },
				relatedLinks: [],
			})
			.expect(200)
		expect(updated.body.currentVersion.versionNo).toBe(2)

		await request(server)
			.post("/api/v1/admin/pisocamp/content")
			.set("Cookie", permitted.cookie)
			.send({ ...createBody, requestId: "2362a347-88bc-42f1-9fe4-1a29af6a4411" })
			.expect(400)
		await request(server)
			.post("/api/v1/admin/pisocamp/content")
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", "ff58025e-7fa4-417c-98c5-8fe44c6ff308")
			.send({ ...createBody, requestId: "8b772b49-672c-456c-9d49-c6f541fdf423" })
			.expect(400)

		await db.insert(pisoCampAccountState).values({
			accountId: permitted.id,
			status: "deactivated",
			reason: "Task 4 replay check",
		})
		await request(server)
			.post("/api/v1/admin/pisocamp/content")
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", CREATE_KEY)
			.send(createBody)
			.expect(401)
	})
})
