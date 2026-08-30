import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, asc, count, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type {
	ApprovePisoCampContentInput,
	ListPisoCampContentReviewQueueInput,
	ListPisoCampContentReviewQueueOutput,
	PisoCampContentDraft,
	PisoCampContentReviewDetail,
	PisoCampContentStatus,
	PisoCampContentWorkflowAction,
	PisoCampRelatedLinkOutput,
	PublishPisoCampContentInput,
	RejectPisoCampContentInput,
	SubmitPisoCampContentInput,
} from "@repo/contracts"
import {
	contentBundleRebuildRequests,
	contentItems,
	contentVersions,
	relatedLinks,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { databaseTransactionContext } from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"

import {
	fromContentVersion,
	selectContentLinks,
	selectContentLinksByVersionIds,
	type ContentDatabase,
} from "./content-mapping"

const allowedTransitions = {
	submit: { from: "draft", to: "submitted_for_review" },
	approve: { from: "submitted_for_review", to: "approved" },
	reject: { from: "submitted_for_review", to: "draft" },
	publish: { from: "approved", to: "published" },
} as const satisfies Readonly<
	Record<PisoCampContentWorkflowAction, { from: PisoCampContentStatus; to: PisoCampContentStatus }>
>

type TransitionInputByAction = {
	submit: SubmitPisoCampContentInput
	approve: ApprovePisoCampContentInput
	reject: RejectPisoCampContentInput
	publish: PublishPisoCampContentInput
}

export interface PisoCampPublishedBundleCandidate {
	itemId: string
	versionId: string
	versionNo: number
	content: PisoCampContentDraft
	relatedLinks: PisoCampRelatedLinkOutput[]
}

const itemCreator = alias(users, "workflow_item_creator")
const itemEditor = alias(users, "workflow_item_editor")
const versionCreator = alias(users, "workflow_version_creator")
const approver = alias(users, "workflow_approver")
const publisher = alias(users, "workflow_publisher")

@Injectable()
export class ContentWorkflowService {
	constructor(private readonly auditService: AuditService) {}

	async transition<Action extends PisoCampContentWorkflowAction>(
		action: Action,
		input: TransitionInputByAction[Action],
		actorId: string
	): Promise<PisoCampContentReviewDetail> {
		return databaseTransactionContext.transaction(async tx => {
			const [item] = await tx
				.select()
				.from(contentItems)
				.where(eq(contentItems.id, input.itemId))
				.for("update")
			if (!item) throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
			if (!item.currentWorkingVersionId) {
				throw new ORPCError("CONFLICT", { message: "Content item has no working version" })
			}

			const [current] = await tx
				.select()
				.from(contentVersions)
				.where(
					and(
						eq(contentVersions.id, item.currentWorkingVersionId),
						eq(contentVersions.itemId, item.id)
					)
				)
			if (!current) {
				throw new ORPCError("CONFLICT", { message: "Working version is missing" })
			}
			if (current.versionNo !== input.expectedVersionNo) {
				throw new ORPCError("CONFLICT", { message: "Content changed during review" })
			}

			const rule = allowedTransitions[action]
			if (!rule || item.status !== rule.from || current.status !== rule.from) {
				throw new ORPCError("CONFLICT", { message: "Content workflow transition is not allowed" })
			}

			const now = new Date()
			const versionId = randomUUID()
			const versionNo = current.versionNo + 1
			const comments = input.comments ?? null
			const approvedBy =
				action === "approve" ? actorId : action === "publish" ? current.approvedBy : null
			const approvedAt =
				action === "approve" ? now : action === "publish" ? current.approvedAt : null
			const publishedBy = action === "publish" ? actorId : null
			const publishedAt = action === "publish" ? now : null

			await tx.insert(contentVersions).values({
				id: versionId,
				itemId: item.id,
				versionNo,
				parentVersionId: current.id,
				status: rule.to,
				contentType: current.contentType,
				title: current.title,
				summary: current.summary,
				body: current.body,
				seriesCode: current.seriesCode,
				denominationCode: current.denominationCode,
				primaryUrl: current.primaryUrl,
				createdBy: actorId,
				createdAt: now,
				approvedBy,
				approvedAt,
				publishedBy,
				publishedAt,
				transitionAction: action,
				transitionComments: comments,
			})

			const currentLinks = await tx
				.select()
				.from(relatedLinks)
				.where(eq(relatedLinks.contentVersionId, current.id))
				.orderBy(asc(relatedLinks.position), asc(relatedLinks.id))
			if (currentLinks.length) {
				await tx.insert(relatedLinks).values(
					currentLinks.map(link => ({
						id: randomUUID(),
						contentVersionId: versionId,
						position: link.position,
						kind: link.kind,
						label: link.label,
						externalUrl: link.externalUrl,
						internalRoute: link.internalRoute,
						targetContentItemId: link.targetContentItemId,
					}))
				)
			}

			await tx
				.update(contentItems)
				.set({
					status: rule.to,
					currentWorkingVersionId: versionId,
					updatedAt: now,
					...(action === "publish"
						? { currentPublishedVersionId: versionId, bundlePending: true }
						: {}),
				})
				.where(eq(contentItems.id, item.id))

			if (action === "publish") {
				await tx.insert(contentBundleRebuildRequests).values({
					id: randomUUID(),
					itemId: item.id,
					publishedVersionId: versionId,
					state: "pending",
					availableAt: now,
					createdAt: now,
				})
			}

			await this.auditService.record(
				{
					domain: "content",
					action: `content.${action}`,
					actorId,
					targetType: "content_item",
					targetId: item.id,
					oldValue: {
						sourceVersionId: current.id,
						sourceVersionNo: current.versionNo,
						fromState: rule.from,
					},
					newValue: {
						targetVersionId: versionId,
						targetVersionNo: versionNo,
						toState: rule.to,
						comments,
					},
				},
				tx
			)

			return this.getReviewDetailFrom(tx, item.id)
		})
	}

	async listReviewQueue(
		input: ListPisoCampContentReviewQueueInput
	): Promise<ListPisoCampContentReviewQueueOutput> {
		const page = typeof input.page === "number" ? input.page : Number(input.page ?? 1)
		const limit = typeof input.limit === "number" ? input.limit : Number(input.limit ?? 20)
		const where = and(
			input.status
				? eq(contentItems.status, input.status)
				: inArray(contentItems.status, ["submitted_for_review", "approved"] as const),
			input.status
				? eq(contentVersions.status, input.status)
				: inArray(contentVersions.status, ["submitted_for_review", "approved"] as const),
			eq(contentItems.status, contentVersions.status)
		)
		const rows = await db
			.select({
				id: contentItems.id,
				contentType: contentItems.contentType,
				status: contentItems.status,
				title: contentVersions.title,
				currentVersionNo: contentVersions.versionNo,
				seriesCode: contentVersions.seriesCode,
				denominationCode: contentVersions.denominationCode,
				creatorId: itemCreator.id,
				creatorName: itemCreator.name,
				editorId: itemEditor.id,
				editorName: itemEditor.name,
				createdAt: contentItems.createdAt,
				dateModified: contentItems.updatedAt,
			})
			.from(contentItems)
			.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
			.innerJoin(itemCreator, eq(contentItems.createdBy, itemCreator.id))
			.innerJoin(itemEditor, eq(contentItems.lastEditedBy, itemEditor.id))
			.where(where)
			.orderBy(asc(contentItems.updatedAt), asc(contentItems.id))
			.limit(limit)
			.offset((page - 1) * limit)
		const totals = await db
			.select({ total: count() })
			.from(contentItems)
			.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
			.where(where)
		return {
			items: rows.map(row => ({
				id: row.id,
				contentType: row.contentType,
				status: row.status as "submitted_for_review" | "approved",
				title: row.title,
				currentVersionNo: row.currentVersionNo,
				...(row.contentType === "advisory" || row.contentType === "link"
					? {}
					: { seriesCode: row.seriesCode!, denominationCode: row.denominationCode! }),
				creator: { id: row.creatorId, name: row.creatorName },
				lastEditor: { id: row.editorId, name: row.editorName },
				createdAt: row.createdAt.toISOString(),
				dateModified: row.dateModified.toISOString(),
			})) as ListPisoCampContentReviewQueueOutput["items"],
			page,
			limit,
			total: totals[0]?.total ?? 0,
		}
	}

	async getReviewDetail(itemId: string): Promise<PisoCampContentReviewDetail> {
		return this.getReviewDetailFrom(db, itemId)
	}

	private async getReviewDetailFrom(
		database: ContentDatabase,
		itemId: string
	): Promise<PisoCampContentReviewDetail> {
		const [row] = await database
			.select({
				id: contentItems.id,
				contentType: contentItems.contentType,
				status: contentItems.status,
				createdAt: contentItems.createdAt,
				dateModified: contentItems.updatedAt,
				creatorId: itemCreator.id,
				creatorName: itemCreator.name,
				editorId: itemEditor.id,
				editorName: itemEditor.name,
				versionId: contentVersions.id,
				versionNo: contentVersions.versionNo,
				versionStatus: contentVersions.status,
				title: contentVersions.title,
				summary: contentVersions.summary,
				body: contentVersions.body,
				seriesCode: contentVersions.seriesCode,
				denominationCode: contentVersions.denominationCode,
				primaryUrl: contentVersions.primaryUrl,
				versionCreatedAt: contentVersions.createdAt,
				transitionAction: contentVersions.transitionAction,
				transitionComments: contentVersions.transitionComments,
				versionCreatorId: versionCreator.id,
				versionCreatorName: versionCreator.name,
				approvedBy: contentVersions.approvedBy,
				approvedAt: contentVersions.approvedAt,
				approverName: approver.name,
				publishedBy: contentVersions.publishedBy,
				publishedAt: contentVersions.publishedAt,
				publisherName: publisher.name,
			})
			.from(contentItems)
			.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
			.innerJoin(itemCreator, eq(contentItems.createdBy, itemCreator.id))
			.innerJoin(itemEditor, eq(contentItems.lastEditedBy, itemEditor.id))
			.innerJoin(versionCreator, eq(contentVersions.createdBy, versionCreator.id))
			.leftJoin(approver, eq(contentVersions.approvedBy, approver.id))
			.leftJoin(publisher, eq(contentVersions.publishedBy, publisher.id))
			.where(eq(contentItems.id, itemId))
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
		if (!row.transitionAction) {
			throw new ORPCError("CONFLICT", { message: "Content item has no workflow transition" })
		}
		return {
			id: row.id,
			contentType: row.contentType,
			status: row.status,
			currentVersion: {
				id: row.versionId,
				versionNo: row.versionNo,
				status: row.versionStatus,
				content: fromContentVersion(row),
				relatedLinks: await selectContentLinks(database, row.versionId),
				createdBy: { id: row.versionCreatorId, name: row.versionCreatorName },
				createdAt: row.versionCreatedAt.toISOString(),
				transition: {
					action: row.transitionAction,
					comments: row.transitionComments,
				} as PisoCampContentReviewDetail["currentVersion"]["transition"],
				approval:
					row.approvedBy && row.approvedAt && row.approverName
						? {
								actor: { id: row.approvedBy, name: row.approverName },
								at: row.approvedAt.toISOString(),
							}
						: null,
				publication:
					row.publishedBy && row.publishedAt && row.publisherName
						? {
								actor: { id: row.publishedBy, name: row.publisherName },
								at: row.publishedAt.toISOString(),
							}
						: null,
			},
			creator: { id: row.creatorId, name: row.creatorName },
			lastEditor: { id: row.editorId, name: row.editorName },
			createdAt: row.createdAt.toISOString(),
			dateModified: row.dateModified.toISOString(),
		}
	}

	async listPublishedBundleCandidates(
		database: ContentDatabase = db
	): Promise<PisoCampPublishedBundleCandidate[]> {
		const rows = await database
			.select({
				itemId: contentItems.id,
				versionId: contentVersions.id,
				versionNo: contentVersions.versionNo,
				contentType: contentVersions.contentType,
				title: contentVersions.title,
				summary: contentVersions.summary,
				body: contentVersions.body,
				seriesCode: contentVersions.seriesCode,
				denominationCode: contentVersions.denominationCode,
				primaryUrl: contentVersions.primaryUrl,
			})
			.from(contentItems)
			.innerJoin(
				contentVersions,
				and(
					eq(contentItems.currentPublishedVersionId, contentVersions.id),
					eq(contentVersions.itemId, contentItems.id)
				)
			)
			.where(and(eq(contentItems.status, "published"), eq(contentVersions.status, "published")))
			.orderBy(asc(contentItems.id))
		const linksByVersionId = await selectContentLinksByVersionIds(
			database,
			rows.map(row => row.versionId)
		)
		return rows.map(row => ({
			itemId: row.itemId,
			versionId: row.versionId,
			versionNo: row.versionNo,
			content: fromContentVersion(row),
			relatedLinks: linksByVersionId.get(row.versionId) ?? [],
		}))
	}
}
