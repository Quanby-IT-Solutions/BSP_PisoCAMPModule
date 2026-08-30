import { and, eq, sql } from "drizzle-orm"

import {
	auditLog,
	contentBundleRebuildRequests,
	contentItems,
	contentVersions,
	relatedLinks,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { PisoCampContentReviewDetailSchema } from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/content.schema"
import { ContentWorkflowService } from "./content-workflow.service"
import { ContentService } from "./content.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const EDITOR_ID = "cm3-task3-editor"
const SUBMITTER_ID = "cm3-task3-submitter"
const APPROVER_ID = "cm3-task3-approver"
const PUBLISHER_ID = "cm3-task3-publisher"
const SECOND_APPROVER_ID = "cm3-task3-second-approver"

const advisory = (title = "Flood advisory") => ({
	contentType: "advisory" as const,
	title,
	summary: "Safety reminder",
	body: "Keep banknotes clean and dry.",
})

const externalLink = {
	kind: "external" as const,
	label: "BSP source",
	url: "https://www.bsp.gov.ph/",
}

function transitionInput(
	itemId: string,
	expectedVersionNo: number
): {
	itemId: string
	requestId: string
	expectedVersionNo: number
}
function transitionInput(
	itemId: string,
	expectedVersionNo: number,
	comments: string
): { itemId: string; requestId: string; expectedVersionNo: number; comments: string }
function transitionInput(
	itemId: string,
	expectedVersionNo: number,
	comments?: string
): { itemId: string; requestId: string; expectedVersionNo: number; comments?: string } {
	return {
		itemId,
		requestId: crypto.randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	}
}

describe("ContentWorkflowService", () => {
	let contentService: ContentService
	let service: ContentWorkflowService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, related_link, content_version,
				content_item, audit_log, idempotency_keys, users restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'Content Editor', 'cm3-editor@example.test', true, now(), now()),
			       (${SUBMITTER_ID}, 'Content Submitter', 'cm3-submitter@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'Content Approver', 'cm3-approver@example.test', true, now(), now()),
			       (${PUBLISHER_ID}, 'Content Publisher', 'cm3-publisher@example.test', true, now(), now()),
			       (${SECOND_APPROVER_ID}, 'Second Approver', 'cm3-second@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, related_link, content_version,
				content_item, audit_log, idempotency_keys restart identity cascade
		`)
		const audit = new AuditService()
		contentService = new ContentService(audit)
		service = new ContentWorkflowService(audit)
	})

	it("appends complete immutable snapshots for submit, approve, publish, and reject", async () => {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [externalLink] },
			EDITOR_ID
		)
		const originalItem = (
			await db.select().from(contentItems).where(eq(contentItems.id, created.id))
		)[0]!
		await db
			.update(contentItems)
			.set({ updatedAt: new Date("2000-01-01T00:00:00.000Z") })
			.where(eq(contentItems.id, created.id))

		const submitted = await service.transition(
			"submit",
			transitionInput(created.id, 1, "Ready for review"),
			SUBMITTER_ID
		)
		const approved = await service.transition(
			"approve",
			transitionInput(created.id, 2, "Verified against BSP source"),
			APPROVER_ID
		)
		const published = await service.transition(
			"publish",
			transitionInput(created.id, 3),
			PUBLISHER_ID
		)
		const submittedReview = PisoCampContentReviewDetailSchema.parse(submitted)
		const approvedReview = PisoCampContentReviewDetailSchema.parse(approved)
		const publishedReview = PisoCampContentReviewDetailSchema.parse(published)
		expect(submittedReview.currentVersion).toMatchObject({
			createdBy: { id: SUBMITTER_ID, name: "Content Submitter" },
			transition: { action: "submit", comments: "Ready for review" },
			approval: null,
			publication: null,
		})
		expect(new Date(submittedReview.currentVersion.createdAt).toISOString()).toBe(
			submittedReview.currentVersion.createdAt
		)
		expect(approvedReview.currentVersion).toMatchObject({
			createdBy: { id: APPROVER_ID, name: "Content Approver" },
			transition: { action: "approve", comments: "Verified against BSP source" },
			approval: { actor: { id: APPROVER_ID, name: "Content Approver" } },
			publication: null,
		})
		expect(publishedReview.currentVersion).toMatchObject({
			createdBy: { id: PUBLISHER_ID, name: "Content Publisher" },
			transition: { action: "publish", comments: null },
			approval: approvedReview.currentVersion.approval,
			publication: { actor: { id: PUBLISHER_ID, name: "Content Publisher" } },
		})

		expect([submitted.status, approved.status, published.status]).toEqual([
			"submitted_for_review",
			"approved",
			"published",
		])
		expect([
			submitted.currentVersion.versionNo,
			approved.currentVersion.versionNo,
			published.currentVersion.versionNo,
		]).toEqual([2, 3, 4])
		for (const detail of [submitted, approved, published]) {
			expect(detail.currentVersion.content).toEqual(advisory())
			expect(detail.currentVersion.relatedLinks[0]).toMatchObject(externalLink)
			expect(detail.lastEditor.id).toBe(EDITOR_ID)
		}

		const versions = await db
			.select()
			.from(contentVersions)
			.where(eq(contentVersions.itemId, created.id))
			.orderBy(contentVersions.versionNo)
		expect(versions).toHaveLength(4)
		expect(versions.map(version => version.parentVersionId)).toEqual([
			null,
			versions[0]!.id,
			versions[1]!.id,
			versions[2]!.id,
		])
		expect(versions.map(version => version.createdBy)).toEqual([
			EDITOR_ID,
			SUBMITTER_ID,
			APPROVER_ID,
			PUBLISHER_ID,
		])
		expect(versions[1]).toMatchObject({
			transitionAction: "submit",
			transitionComments: "Ready for review",
			approvedBy: null,
			publishedBy: null,
		})
		expect(versions[2]).toMatchObject({
			transitionAction: "approve",
			transitionComments: "Verified against BSP source",
			approvedBy: APPROVER_ID,
			publishedBy: null,
		})
		expect(versions[3]).toMatchObject({
			transitionAction: "publish",
			transitionComments: null,
			approvedBy: APPROVER_ID,
			publishedBy: PUBLISHER_ID,
		})
		expect(versions[3]!.approvedAt).toEqual(versions[2]!.approvedAt)
		expect(versions[3]!.publishedAt).toBeInstanceOf(Date)

		const links = await db
			.select()
			.from(relatedLinks)
			.where(eq(relatedLinks.label, externalLink.label))
		expect(links).toHaveLength(4)
		expect(new Set(links.map(item => item.contentVersionId))).toEqual(
			new Set(versions.map(version => version.id))
		)

		const item = (await db.select().from(contentItems).where(eq(contentItems.id, created.id)))[0]!
		expect(item).toMatchObject({
			status: "published",
			currentWorkingVersionId: versions[3]!.id,
			currentPublishedVersionId: versions[3]!.id,
			bundlePending: true,
			lastEditedBy: originalItem.lastEditedBy,
		})
		expect(item.updatedAt.getTime()).toBeGreaterThan(new Date("2000-01-01T00:00:00.000Z").getTime())

		const outbox = await db
			.select()
			.from(contentBundleRebuildRequests)
			.where(eq(contentBundleRebuildRequests.itemId, created.id))
		expect(outbox).toHaveLength(1)
		expect(outbox[0]).toMatchObject({
			publishedVersionId: versions[3]!.id,
			state: "pending",
			attemptCount: 0,
		})

		const workflowAudits = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.targetId, created.id), eq(auditLog.domain, "content")))
		expect(workflowAudits.filter(entry => entry.action !== "content.create")).toHaveLength(3)
		expect(workflowAudits.find(entry => entry.action === "content.publish")).toMatchObject({
			actorId: PUBLISHER_ID,
			oldValue: {
				sourceVersionId: versions[2]!.id,
				sourceVersionNo: 3,
				fromState: "approved",
			},
			newValue: {
				targetVersionId: versions[3]!.id,
				targetVersionNo: 4,
				toState: "published",
				comments: null,
			},
		})

		const rejectedSource = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Reject me"), relatedLinks: [] },
			EDITOR_ID
		)
		await service.transition("submit", transitionInput(rejectedSource.id, 1), SUBMITTER_ID)
		const rejected = await service.transition(
			"reject",
			transitionInput(rejectedSource.id, 2, "Citations need correction"),
			SECOND_APPROVER_ID
		)
		const rejectedReview = PisoCampContentReviewDetailSchema.parse(rejected)
		expect(rejectedReview.currentVersion).toMatchObject({
			createdBy: { id: SECOND_APPROVER_ID, name: "Second Approver" },
			transition: { action: "reject", comments: "Citations need correction" },
			approval: null,
			publication: null,
		})
		expect(rejected).toMatchObject({ status: "draft", lastEditor: { id: EDITOR_ID } })
		const rejectedVersion = (
			await db
				.select()
				.from(contentVersions)
				.where(eq(contentVersions.id, rejected.currentVersion.id))
		)[0]!
		expect(rejectedVersion).toMatchObject({
			status: "draft",
			createdBy: SECOND_APPROVER_ID,
			transitionAction: "reject",
			transitionComments: "Citations need correction",
			approvedBy: null,
			publishedBy: null,
		})
	})

	it("rejects every illegal state/action pair without partial writes", async () => {
		const makeAtState = async (
			target: "draft" | "submitted_for_review" | "approved" | "published"
		) => {
			const created = await contentService.create(
				{ requestId: crypto.randomUUID(), content: advisory(target), relatedLinks: [] },
				EDITOR_ID
			)
			if (target === "draft") return created
			const submitted = await service.transition(
				"submit",
				transitionInput(created.id, 1),
				SUBMITTER_ID
			)
			if (target === "submitted_for_review") return submitted
			const approved = await service.transition(
				"approve",
				transitionInput(created.id, 2, "Approved"),
				APPROVER_ID
			)
			if (target === "approved") return approved
			return service.transition("publish", transitionInput(created.id, 3), PUBLISHER_ID)
		}

		const cases = [
			{ state: "draft" as const, illegal: ["approve", "reject", "publish"] as const },
			{ state: "submitted_for_review" as const, illegal: ["submit", "publish"] as const },
			{ state: "approved" as const, illegal: ["submit", "approve", "reject"] as const },
			{ state: "published" as const, illegal: ["submit", "approve", "reject", "publish"] as const },
		]
		for (const entry of cases) {
			const detail = await makeAtState(entry.state)
			for (const action of entry.illegal) {
				const beforeVersions = await db
					.select({ id: contentVersions.id })
					.from(contentVersions)
					.where(eq(contentVersions.itemId, detail.id))
				const beforeAudits = await db
					.select({ id: auditLog.id })
					.from(auditLog)
					.where(eq(auditLog.targetId, detail.id))
				await expect(
					service.transition(
						action,
						transitionInput(
							detail.id,
							detail.currentVersion.versionNo,
							"Required comment"
						) as never,
						APPROVER_ID
					)
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(
					await db
						.select({ id: contentVersions.id })
						.from(contentVersions)
						.where(eq(contentVersions.itemId, detail.id))
				).toEqual(beforeVersions)
				expect(
					await db
						.select({ id: auditLog.id })
						.from(auditLog)
						.where(eq(auditLog.targetId, detail.id))
				).toEqual(beforeAudits)
			}
		}
	})

	it("returns typed conflicts for stale or missing working versions and 404 for a missing item", async () => {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [] },
			EDITOR_ID
		)
		await expect(
			service.transition("submit", transitionInput(created.id, 99), SUBMITTER_ID)
		).rejects.toMatchObject({ code: "CONFLICT", message: "Content changed during review" })

		await db
			.update(contentItems)
			.set({ currentWorkingVersionId: null })
			.where(eq(contentItems.id, created.id))
		await expect(
			service.transition("submit", transitionInput(created.id, 1), SUBMITTER_ID)
		).rejects.toMatchObject({ code: "CONFLICT", message: "Content item has no working version" })

		await expect(
			service.transition(
				"submit",
				transitionInput("7a40fcfb-fdf2-4612-8198-567a09eb8e26", 1),
				SUBMITTER_ID
			)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})

	it("serializes concurrent transitions under the item row lock", async () => {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [] },
			EDITOR_ID
		)
		const results = await Promise.allSettled([
			service.transition("submit", transitionInput(created.id, 1), SUBMITTER_ID),
			service.transition("submit", transitionInput(created.id, 1), SECOND_APPROVER_ID),
		])
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
		expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
		expect(results.find(result => result.status === "rejected")).toMatchObject({
			reason: { code: "CONFLICT" },
		})
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(2)
	})

	it("rolls back snapshots, links, item pointers, and outbox when audit persistence fails", async () => {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [externalLink] },
			EDITOR_ID
		)
		await service.transition("submit", transitionInput(created.id, 1), SUBMITTER_ID)
		await service.transition("approve", transitionInput(created.id, 2, "Approved"), APPROVER_ID)
		const failing = new ContentWorkflowService({
			record: jest.fn().mockRejectedValue(new Error("audit unavailable")),
		} as unknown as AuditService)
		const beforeItem = (
			await db.select().from(contentItems).where(eq(contentItems.id, created.id))
		)[0]!
		await expect(
			failing.transition("publish", transitionInput(created.id, 3), PUBLISHER_ID)
		).rejects.toThrow("audit unavailable")
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(3)
		expect(
			await db.select().from(relatedLinks).where(eq(relatedLinks.label, externalLink.label))
		).toHaveLength(3)
		expect(await db.select().from(contentBundleRebuildRequests)).toHaveLength(0)
		expect(
			(await db.select().from(contentItems).where(eq(contentItems.id, created.id)))[0]
		).toEqual(beforeItem)
	})

	it("rolls back publication when the rebuild outbox insert fails", async () => {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory(), relatedLinks: [] },
			EDITOR_ID
		)
		await service.transition("submit", transitionInput(created.id, 1), SUBMITTER_ID)
		await service.transition("approve", transitionInput(created.id, 2, "Approved"), APPROVER_ID)
		const beforeItem = (
			await db.select().from(contentItems).where(eq(contentItems.id, created.id))
		)[0]!
		await db.execute(sql`
			create function cm3_task3_force_outbox_failure() returns trigger as $$
			begin raise exception 'forced outbox failure'; end;
			$$ language plpgsql;
			create trigger cm3_task3_force_outbox_failure
			before insert on content_bundle_rebuild_request
			for each row execute function cm3_task3_force_outbox_failure();
		`)
		try {
			await expect(
				service.transition("publish", transitionInput(created.id, 3), PUBLISHER_ID)
			).rejects.toThrow("Failed query")
		} finally {
			await db.execute(sql`
				drop trigger if exists cm3_task3_force_outbox_failure on content_bundle_rebuild_request;
				drop function if exists cm3_task3_force_outbox_failure();
			`)
		}
		expect(
			await db.select().from(contentVersions).where(eq(contentVersions.itemId, created.id))
		).toHaveLength(3)
		expect(await db.select().from(contentBundleRebuildRequests)).toHaveLength(0)
		expect(
			(await db.select().from(contentItems).where(eq(contentItems.id, created.id)))[0]
		).toEqual(beforeItem)
		expect(
			await db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.targetId, created.id), eq(auditLog.action, "content.publish")))
		).toHaveLength(0)
	})

	it("returns stable review pages and schema-valid rich review details", async () => {
		const first = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("First"), relatedLinks: [] },
			EDITOR_ID
		)
		const second = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Second"), relatedLinks: [] },
			EDITOR_ID
		)
		const excluded = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Draft"), relatedLinks: [] },
			EDITOR_ID
		)
		await service.transition("submit", transitionInput(first.id, 1), SUBMITTER_ID)
		await service.transition("submit", transitionInput(second.id, 1), SUBMITTER_ID)
		await service.transition(
			"approve",
			transitionInput(second.id, 2, "Complete and accurate"),
			APPROVER_ID
		)
		const tiedAt = new Date("2024-01-01T00:00:00.000Z")
		await db.update(contentItems).set({ updatedAt: tiedAt }).where(eq(contentItems.id, first.id))
		await db.update(contentItems).set({ updatedAt: tiedAt }).where(eq(contentItems.id, second.id))

		const pageOne = await service.listReviewQueue({ page: 1, limit: 1 })
		const pageTwo = await service.listReviewQueue({ page: 2, limit: 1 })
		expect(pageOne.total).toBe(2)
		expect(pageTwo.total).toBe(2)
		expect([pageOne.items[0]!.id, pageTwo.items[0]!.id]).toEqual([first.id, second.id].sort())
		expect([pageOne.items[0]!.id, pageTwo.items[0]!.id]).not.toContain(excluded.id)
		expect(
			(await service.listReviewQueue({ page: 1, limit: 20, status: "approved" })).items
		).toHaveLength(1)

		const detail = await service.getReviewDetail(second.id)
		expect(PisoCampContentReviewDetailSchema.parse(detail)).toEqual(detail)
		expect(detail.currentVersion).toMatchObject({
			createdBy: { id: APPROVER_ID, name: "Content Approver" },
			transition: { action: "approve", comments: "Complete and accurate" },
			approval: { actor: { id: APPROVER_ID, name: "Content Approver" } },
			publication: null,
		})
	})

	it("returns only exact published pointers as bundle candidates", async () => {
		const publishedItem = await contentService.create(
			{
				requestId: crypto.randomUUID(),
				content: advisory("Published"),
				relatedLinks: [externalLink],
			},
			EDITOR_ID
		)
		const draft = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Draft"), relatedLinks: [] },
			EDITOR_ID
		)
		const submitted = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Submitted"), relatedLinks: [] },
			EDITOR_ID
		)
		const approved = await contentService.create(
			{ requestId: crypto.randomUUID(), content: advisory("Approved"), relatedLinks: [] },
			EDITOR_ID
		)
		await service.transition("submit", transitionInput(publishedItem.id, 1), SUBMITTER_ID)
		await service.transition(
			"approve",
			transitionInput(publishedItem.id, 2, "Approved"),
			APPROVER_ID
		)
		const published = await service.transition(
			"publish",
			transitionInput(publishedItem.id, 3),
			PUBLISHER_ID
		)
		await service.transition("submit", transitionInput(submitted.id, 1), SUBMITTER_ID)
		await service.transition("submit", transitionInput(approved.id, 1), SUBMITTER_ID)
		await service.transition("approve", transitionInput(approved.id, 2, "Approved"), APPROVER_ID)

		const pointed = (
			await db
				.select()
				.from(contentVersions)
				.where(eq(contentVersions.id, published.currentVersion.id))
		)[0]!
		await db.insert(contentVersions).values({
			...pointed,
			id: crypto.randomUUID(),
			versionNo: pointed.versionNo + 1,
			parentVersionId: pointed.id,
			createdAt: new Date(),
		})

		const candidates = await service.listPublishedBundleCandidates()
		expect(candidates).toHaveLength(1)
		expect(candidates[0]).toMatchObject({
			itemId: publishedItem.id,
			versionId: published.currentVersion.id,
			versionNo: 4,
			content: advisory("Published"),
		})
		expect(candidates[0]).not.toHaveProperty("approvedBy")
		expect(candidates[0]).not.toHaveProperty("publishedBy")
		expect(candidates[0]!.relatedLinks[0]).toMatchObject(externalLink)
		expect(candidates.map(candidate => candidate.itemId)).not.toEqual(
			expect.arrayContaining([draft.id, submitted.id, approved.id])
		)
	})

	it("batch-loads related links with one links query for multiple bundle candidates", async () => {
		const publish = async (title: string, label: string) => {
			const created = await contentService.create(
				{
					requestId: crypto.randomUUID(),
					content: advisory(title),
					relatedLinks: [{ ...externalLink, label }],
				},
				EDITOR_ID
			)
			await service.transition("submit", transitionInput(created.id, 1), SUBMITTER_ID)
			await service.transition("approve", transitionInput(created.id, 2, "Approved"), APPROVER_ID)
			await service.transition("publish", transitionInput(created.id, 3), PUBLISHER_ID)
			return created.id
		}
		const firstId = await publish("First published", "First source")
		const secondId = await publish("Second published", "Second source")
		const selectSpy = jest.spyOn(db, "select")

		try {
			const candidates = await service.listPublishedBundleCandidates()
			expect(candidates.map(candidate => candidate.itemId)).toEqual([firstId, secondId].sort())
			expect(
				candidates.flatMap(candidate => candidate.relatedLinks.map(link => link.label)).sort()
			).toEqual(["First source", "Second source"])
			expect(selectSpy).toHaveBeenCalledTimes(2)
		} finally {
			selectSpy.mockRestore()
		}
	})
})
