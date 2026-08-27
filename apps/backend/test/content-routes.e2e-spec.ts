import { type INestApplication } from "@nestjs/common"
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals"
import { and, eq, sql } from "drizzle-orm"
import request from "supertest"
import { type App } from "supertest/types"

import {
	auditLog,
	contentBundleRebuildRequests,
	contentItems,
	contentVersions,
	idempotencyKeys,
	permissions,
	pisoCampAccountState,
	relatedLinks,
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
const SUBMIT_KEY = "3fc8eff4-2284-42af-a40d-a97ac8374d54"
const APPROVE_KEY = "346342cc-d367-421e-afbd-1920eb6c08aa"
const PUBLISH_KEY = "50b4d1ee-d9b8-491f-a608-55884f09e563"
const REJECT_CREATE_KEY = "f4da0381-7e62-4fc1-842c-8888666f8ba0"
const REJECT_SUBMIT_KEY = "6b25ab0e-aa61-4862-82e0-d8c684be713d"
const REJECT_KEY = "4b33cff2-782c-454d-a5a8-cbdb2dd8b82b"

type Identity = { id: string; cookie: string }

describe("composed v1 Piso CAMP content routes", () => {
	let app: INestApplication<App>
	let permitted: Identity
	let approver: Identity
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
		approver = await register("content-approver")
		missingPermission = await register("content-missing")

		const permissionRows = await db
			.insert(permissions)
			.values(
				[
					"content.items.edit",
					"content.items.submit",
					"content.items.approve",
					"content.items.publish",
				].map(name => ({ name, description: `Task 4 ${name}` }))
			)
			.returning()
		const permissionByName = new Map(
			permissionRows.map(permission => [permission.name, permission])
		)
		const roleRows = await db
			.insert(roles)
			.values([
				{ name: "Task 4 Content Editor", description: "Task-owned editor role" },
				{ name: "Task 4 Content Approver", description: "Task-owned approver role" },
			])
			.returning()
		const editorRole = roleRows.find(role => role.name === "Task 4 Content Editor")!
		const approverRole = roleRows.find(role => role.name === "Task 4 Content Approver")!
		await db.insert(rolePermissions).values([
			{
				roleId: editorRole.id,
				permissionId: permissionByName.get("content.items.edit")!.id,
			},
			{
				roleId: editorRole.id,
				permissionId: permissionByName.get("content.items.submit")!.id,
			},
			{
				roleId: approverRole.id,
				permissionId: permissionByName.get("content.items.approve")!.id,
			},
			{
				roleId: approverRole.id,
				permissionId: permissionByName.get("content.items.publish")!.id,
			},
		])
		await db.insert(userRoles).values([
			{ userId: permitted.id, roleId: editorRole.id },
			{ userId: approver.id, roleId: approverRole.id },
		])
	})

	afterAll(async () => {
		await app?.close()
	})

	it("enforces auth, RBAC, idempotency, workflow collision safety, and all real content procedures", async () => {
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

		await request(server)
			.get("/api/v1/admin/pisocamp/content/review-queue?page=1&limit=20")
			.expect(401)
		await request(server)
			.get("/api/v1/admin/pisocamp/content/review-queue?page=1&limit=20")
			.set("Cookie", permitted.cookie)
			.expect(403)

		const submitBody = {
			itemId: created.body.id as string,
			requestId: SUBMIT_KEY,
			expectedVersionNo: 2,
			comments: "Ready for independent review",
		}
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.send(submitBody)
			.expect(400)
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", "not-a-uuid")
			.send({ ...submitBody, requestId: "not-a-uuid" })
			.expect(400)
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", "58404b41-a0b9-40f3-a04c-f4444907ace7")
			.send(submitBody)
			.expect(400)

		const submitted = await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", SUBMIT_KEY)
			.send(submitBody)
			.expect(200)
		expect(submitted.body).toMatchObject({
			id: created.body.id,
			status: "submitted_for_review",
			currentVersion: {
				versionNo: 3,
				status: "submitted_for_review",
				transition: { action: "submit", comments: submitBody.comments },
				createdBy: { id: permitted.id },
			},
		})

		const rowCounts = async () => ({
			items: (await db.select().from(contentItems)).length,
			versions: (await db.select().from(contentVersions)).length,
			links: (await db.select().from(relatedLinks)).length,
			audits: (await db.select().from(auditLog)).length,
			outbox: (await db.select().from(contentBundleRebuildRequests)).length,
			idempotency: (await db.select().from(idempotencyKeys)).length,
		})
		const submittedCounts = await rowCounts()
		const submitReplay = await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", SUBMIT_KEY)
			.send(submitBody)
			.expect(200)
		expect(submitReplay.body).toEqual(submitted.body)
		expect(await rowCounts()).toEqual(submittedCounts)
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", SUBMIT_KEY)
			.send({ ...submitBody, comments: "Changed after the first request" })
			.expect(409)
		expect(await rowCounts()).toEqual(submittedCounts)

		for (const [action, permission, key] of [
			["approve", "content.items.approve", "d371b079-bf99-4d02-a22c-7a861a56e433"],
			["reject", "content.items.approve", "d608f728-df3b-4bbd-ae42-c04c0a469bc3"],
			["publish", "content.items.publish", "f109079b-ce6b-4d70-9204-49266d59a37a"],
		] as const) {
			await request(server)
				.post(`/api/v1/admin/pisocamp/content/${created.body.id}/${action}`)
				.set("Cookie", permitted.cookie)
				.set("Idempotency-Key", key)
				.send({
					itemId: created.body.id,
					requestId: key,
					expectedVersionNo: 3,
					comments: "Unauthorized workflow attempt",
				})
				.expect(403)

			const [denial] = await db
				.select()
				.from(auditLog)
				.where(
					and(
						eq(auditLog.actorId, permitted.id),
						eq(auditLog.action, "permission_denied"),
						eq(auditLog.targetId, `ContentController.${action}Content`)
					)
				)
			expect(denial?.newValue).toEqual({
				requiredPermissions: [permission],
				missingPermissions: [permission],
			})
		}

		const queue = await request(server)
			.get("/api/v1/admin/pisocamp/content/review-queue?page=1&limit=20")
			.set("Cookie", approver.cookie)
			.expect(200)
		expect(queue.body).toMatchObject({ total: 1, items: [{ id: created.body.id }] })

		const review = await request(server)
			.get(`/api/v1/admin/pisocamp/content/${created.body.id}/review`)
			.set("Cookie", approver.cookie)
			.expect(200)
		expect(review.body).toEqual(submitted.body)

		const approved = await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/approve`)
			.set("Cookie", approver.cookie)
			.set("Idempotency-Key", APPROVE_KEY)
			.send({
				itemId: created.body.id,
				requestId: APPROVE_KEY,
				expectedVersionNo: 3,
				comments: "Evidence verified",
			})
			.expect(200)
		expect(approved.body).toMatchObject({
			status: "approved",
			currentVersion: {
				versionNo: 4,
				transition: { action: "approve", comments: "Evidence verified" },
				approval: { actor: { id: approver.id } },
			},
		})
		const approvedCounts = await rowCounts()
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/publish`)
			.set("Cookie", approver.cookie)
			.set("Idempotency-Key", APPROVE_KEY)
			.send({
				itemId: created.body.id,
				requestId: APPROVE_KEY,
				expectedVersionNo: 4,
				comments: "Attempted cross-operation reuse",
			})
			.expect(409)
		expect(await rowCounts()).toEqual(approvedCounts)

		const publishBody = {
			itemId: created.body.id as string,
			requestId: PUBLISH_KEY,
			expectedVersionNo: 4,
			comments: "Release authorized",
		}
		const published = await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/publish`)
			.set("Cookie", approver.cookie)
			.set("Idempotency-Key", PUBLISH_KEY)
			.send(publishBody)
			.expect(200)
		expect(published.body).toMatchObject({
			status: "published",
			currentVersion: {
				versionNo: 5,
				transition: { action: "publish", comments: publishBody.comments },
				approval: { actor: { id: approver.id } },
				publication: { actor: { id: approver.id } },
			},
		})
		const publishedCounts = await rowCounts()
		const publishReplay = await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/publish`)
			.set("Cookie", approver.cookie)
			.set("Idempotency-Key", PUBLISH_KEY)
			.send(publishBody)
			.expect(200)
		expect(publishReplay.body).toEqual(published.body)
		expect(await rowCounts()).toEqual(publishedCounts)

		const rejectDraft = await request(server)
			.post("/api/v1/admin/pisocamp/content")
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", REJECT_CREATE_KEY)
			.send({
				...createBody,
				requestId: REJECT_CREATE_KEY,
				content: { ...createBody.content, title: "Advisory requiring correction" },
			})
			.expect(200)
		const beforeRejectDraftSubmit = await rowCounts()
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${rejectDraft.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", SUBMIT_KEY)
			.send({
				itemId: rejectDraft.body.id,
				requestId: SUBMIT_KEY,
				expectedVersionNo: 1,
			})
			.expect(409)
		expect(await rowCounts()).toEqual(beforeRejectDraftSubmit)
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${rejectDraft.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", REJECT_SUBMIT_KEY)
			.send({
				itemId: rejectDraft.body.id,
				requestId: REJECT_SUBMIT_KEY,
				expectedVersionNo: 1,
			})
			.expect(200)
		const rejected = await request(server)
			.post(`/api/v1/admin/pisocamp/content/${rejectDraft.body.id}/reject`)
			.set("Cookie", approver.cookie)
			.set("Idempotency-Key", REJECT_KEY)
			.send({
				itemId: rejectDraft.body.id,
				requestId: REJECT_KEY,
				expectedVersionNo: 2,
				comments: "Please correct the source attribution",
			})
			.expect(200)
		expect(rejected.body).toMatchObject({
			status: "draft",
			currentVersion: {
				versionNo: 3,
				transition: {
					action: "reject",
					comments: "Please correct the source attribution",
				},
				createdBy: { id: approver.id },
			},
		})
		const afterRejectedCounts = await rowCounts()

		await db.insert(pisoCampAccountState).values({
			accountId: permitted.id,
			status: "deactivated",
			reason: "Task 4 replay check",
		})
		await request(server)
			.post(`/api/v1/admin/pisocamp/content/${created.body.id}/submit`)
			.set("Cookie", permitted.cookie)
			.set("Idempotency-Key", SUBMIT_KEY)
			.send(submitBody)
			.expect(401)
		expect(await rowCounts()).toEqual(afterRejectedCounts)
	})
})
