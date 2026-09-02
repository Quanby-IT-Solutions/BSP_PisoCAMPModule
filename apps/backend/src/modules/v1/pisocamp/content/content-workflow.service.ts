import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type {
	ApprovePisoCampContentInput,
	ListPisoCampContentReviewQueueInput,
	ListPisoCampContentReviewQueueOutput,
	ListPisoCampContentVersionsInput,
	ListPisoCampContentVersionsOutput,
	PisoCampContentDifference,
	PisoCampContentDraft,
	PisoCampContentReviewDetail,
	PisoCampContentStatus,
	PisoCampContentWorkflowAction,
	PisoCampRelatedLinkOutput,
	PublishPisoCampContentInput,
	RejectPisoCampContentInput,
	RestorePisoCampContentVersionInput,
	SubmitPisoCampContentInput,
} from "@repo/contracts"
import {
	PISO_CAMP_CONTENT_DIFF_FIELDS,
	PISO_CAMP_RESTORABLE_STATUSES,
	PISO_CAMP_RESTORE_SOURCE_ITEM_STATUSES,
} from "@repo/contracts/pisocamp-version-history"
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

import { copyVersionAssets, selectVersionAssets } from "../assets/version-assets"
import {
	fromContentVersion,
	selectContentLinks,
	selectContentLinksByVersionIds,
	type ContentDatabase,
} from "./content-mapping"

const RESTORABLE_SOURCE_STATUSES = new Set<string>(PISO_CAMP_RESTORABLE_STATUSES)
const RESTORE_SOURCE_ITEM_STATUSES = new Set<string>(PISO_CAMP_RESTORE_SOURCE_ITEM_STATUSES)

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

type ComparableFields = Record<string, string | null>

function renderAssets(attachments: { role: string; asset: { sha256: string } }[]): string | null {
	if (!attachments.length) return null
	return attachments.map(entry => `${entry.role} ${entry.asset.sha256}`).join("\n")
}

function renderLinks(links: PisoCampRelatedLinkOutput[]): string | null {
	if (!links.length) return null
	return links
		.map(link =>
			link.kind === "external"
				? `external ${link.label} ${link.url}`
				: link.kind === "internal"
					? `internal ${link.label} ${link.route}`
					: `topic ${link.label} ${link.targetContentItemId}`
		)
		.join("\n")
}

/**
 * Render one version as comparable text per diffable field.
 *
 * Text, not structured values, because the difference is read by a human and
 * both sides have to render the same way to be comparable at all.
 */
function comparableFields(
	version: {
		title: string
		summary: string
		body: string | null
		seriesCode: string | null
		denominationCode: string | null
		primaryUrl: string | null
	},
	links: PisoCampRelatedLinkOutput[],
	assets: string | null
): ComparableFields {
	return {
		title: version.title,
		summary: version.summary,
		body: version.body,
		seriesCode: version.seriesCode,
		denominationCode: version.denominationCode,
		primaryUrl: version.primaryUrl,
		relatedLinks: renderLinks(links),
		assets,
	}
}

function differencesBetween(
	previous: ComparableFields,
	current: ComparableFields
): PisoCampContentDifference[] {
	const differences: PisoCampContentDifference[] = []
	for (const field of PISO_CAMP_CONTENT_DIFF_FIELDS) {
		const before = previous[field] ?? null
		const after = current[field] ?? null
		if (before !== after) differences.push({ field, previous: before, current: after })
	}
	return differences
}

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
			await copyVersionAssets(tx, {
				contentItemId: item.id,
				sourceVersionId: current.id,
				targetVersionId: versionId,
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

	/**
	 * CM-4 restore.
	 *
	 * Restore is an approval, not a shortcut around one: it appends a NEW
	 * immutable version in `approved` state that copies a previously approved
	 * one, and leaves publication to CM-3. `current_published_version_id` is
	 * untouched, so whatever is live stays live until someone publishes the
	 * restored version - reverting a bad publication never blanks the app in
	 * the meantime.
	 */
	async restore(
		input: RestorePisoCampContentVersionInput,
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
			if (!current) throw new ORPCError("CONFLICT", { message: "Working version is missing" })
			if (current.versionNo !== input.expectedVersionNo) {
				throw new ORPCError("CONFLICT", { message: "Content changed during review" })
			}
			if (!RESTORE_SOURCE_ITEM_STATUSES.has(item.status)) {
				throw new ORPCError("CONFLICT", {
					message: "Content cannot be restored while it is under review or archived",
				})
			}

			const [source] = await tx
				.select()
				.from(contentVersions)
				.where(
					and(eq(contentVersions.itemId, item.id), eq(contentVersions.versionNo, input.versionNo))
				)
			if (!source) throw new ORPCError("NOT_FOUND", { message: "Content version not found" })
			if (!RESTORABLE_SOURCE_STATUSES.has(source.status)) {
				throw new ORPCError("CONFLICT", {
					message: "Only a previously approved or published version can be restored",
				})
			}

			const now = new Date()
			const versionId = randomUUID()
			// The highest number in history, not the working version's: a restore
			// source is any historical version, and history can outrun the working
			// pointer. `current + 1` would collide with an existing number.
			const [highest] = await tx
				.select({ versionNo: max(contentVersions.versionNo) })
				.from(contentVersions)
				.where(eq(contentVersions.itemId, item.id))
			const versionNo = (highest?.versionNo ?? current.versionNo) + 1

			await tx.insert(contentVersions).values({
				id: versionId,
				itemId: item.id,
				versionNo,
				parentVersionId: current.id,
				restoredFromVersionId: source.id,
				status: "approved",
				contentType: source.contentType,
				title: source.title,
				summary: source.summary,
				body: source.body,
				seriesCode: source.seriesCode,
				denominationCode: source.denominationCode,
				primaryUrl: source.primaryUrl,
				createdBy: actorId,
				createdAt: now,
				approvedBy: actorId,
				approvedAt: now,
				publishedBy: null,
				publishedAt: null,
				transitionAction: "approve",
				transitionComments: input.comments,
			})
			// Assets and links come from the SOURCE, not the working version:
			// restoring copy while keeping the current attachments would produce
			// a combination nobody ever approved.
			await copyVersionAssets(tx, {
				contentItemId: item.id,
				sourceVersionId: source.id,
				targetVersionId: versionId,
			})

			const sourceLinks = await tx
				.select()
				.from(relatedLinks)
				.where(eq(relatedLinks.contentVersionId, source.id))
				.orderBy(asc(relatedLinks.position), asc(relatedLinks.id))
			if (sourceLinks.length) {
				await tx.insert(relatedLinks).values(
					sourceLinks.map(link => ({
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
				.set({ status: "approved", currentWorkingVersionId: versionId, updatedAt: now })
				.where(eq(contentItems.id, item.id))

			await this.auditService.record(
				{
					domain: "content",
					action: "content.restore",
					actorId,
					targetType: "content_item",
					targetId: item.id,
					oldValue: {
						sourceVersionId: source.id,
						sourceVersionNo: source.versionNo,
						sourceState: source.status,
						fromState: item.status,
					},
					newValue: {
						targetVersionId: versionId,
						targetVersionNo: versionNo,
						toState: "approved",
						comments: input.comments,
					},
				},
				tx
			)

			return this.getReviewDetailFrom(tx, item.id)
		})
	}

	/**
	 * Version history with a field-level difference against the current working
	 * version, newest first.
	 *
	 * Differences are computed here rather than in the browser so every reader
	 * sees the same history and a 10 000-character body is compared once.
	 */
	async listVersionHistory(
		input: ListPisoCampContentVersionsInput
	): Promise<ListPisoCampContentVersionsOutput> {
		const page = Number(input.page ?? 1)
		const limit = Number(input.limit ?? 20)

		const [item] = await db.select().from(contentItems).where(eq(contentItems.id, input.itemId))
		if (!item || !item.currentWorkingVersionId) {
			throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
		}

		const [currentRow] = await db
			.select()
			.from(contentVersions)
			.where(eq(contentVersions.id, item.currentWorkingVersionId))
		if (!currentRow) throw new ORPCError("CONFLICT", { message: "Working version is missing" })

		const [totals] = await db
			.select({ total: count() })
			.from(contentVersions)
			.where(eq(contentVersions.itemId, item.id))

		const rows = await db
			.select({
				id: contentVersions.id,
				versionNo: contentVersions.versionNo,
				status: contentVersions.status,
				contentType: contentVersions.contentType,
				title: contentVersions.title,
				summary: contentVersions.summary,
				body: contentVersions.body,
				seriesCode: contentVersions.seriesCode,
				denominationCode: contentVersions.denominationCode,
				primaryUrl: contentVersions.primaryUrl,
				createdAt: contentVersions.createdAt,
				creatorId: versionCreator.id,
				creatorName: versionCreator.name,
				approvedBy: contentVersions.approvedBy,
				approvedAt: contentVersions.approvedAt,
				approverName: approver.name,
				publishedBy: contentVersions.publishedBy,
				publishedAt: contentVersions.publishedAt,
				publisherName: publisher.name,
				transitionAction: contentVersions.transitionAction,
				transitionComments: contentVersions.transitionComments,
				restoredFromVersionId: contentVersions.restoredFromVersionId,
			})
			.from(contentVersions)
			.innerJoin(versionCreator, eq(contentVersions.createdBy, versionCreator.id))
			.leftJoin(approver, eq(contentVersions.approvedBy, approver.id))
			.leftJoin(publisher, eq(contentVersions.publishedBy, publisher.id))
			.where(eq(contentVersions.itemId, item.id))
			.orderBy(desc(contentVersions.versionNo))
			.limit(limit)
			.offset((page - 1) * limit)

		const versionNoById = new Map(
			(
				await db
					.select({ id: contentVersions.id, versionNo: contentVersions.versionNo })
					.from(contentVersions)
					.where(eq(contentVersions.itemId, item.id))
			).map(row => [row.id, row.versionNo])
		)

		const comparedIds = [...new Set([currentRow.id, ...rows.map(row => row.id)])]
		const linksByVersionId = await selectContentLinksByVersionIds(db, comparedIds)
		const assetsByVersionId = new Map<string, string | null>()
		for (const versionId of comparedIds) {
			assetsByVersionId.set(
				versionId,
				renderAssets(await selectVersionAssets(db, item.id, versionId))
			)
		}

		const currentFields = comparableFields(
			currentRow,
			linksByVersionId.get(currentRow.id) ?? [],
			assetsByVersionId.get(currentRow.id) ?? null
		)
		const restoreAvailable = RESTORE_SOURCE_ITEM_STATUSES.has(item.status)

		return {
			itemId: item.id,
			itemStatus: item.status,
			currentVersionNo: currentRow.versionNo,
			restoreAvailable,
			page,
			limit,
			total: totals?.total ?? 0,
			versions: rows.map(row => {
				const isCurrentWorking = row.id === currentRow.id
				const fields = comparableFields(
					row,
					linksByVersionId.get(row.id) ?? [],
					assetsByVersionId.get(row.id) ?? null
				)
				return {
					id: row.id,
					versionNo: row.versionNo,
					status: row.status,
					contentType: row.contentType,
					title: row.title,
					createdBy: { id: row.creatorId, name: row.creatorName },
					createdAt: row.createdAt.toISOString(),
					approver:
						row.approvedBy && row.approverName
							? { id: row.approvedBy, name: row.approverName }
							: null,
					approvedAt: row.approvedAt?.toISOString() ?? null,
					publisher:
						row.publishedBy && row.publisherName
							? { id: row.publishedBy, name: row.publisherName }
							: null,
					publishedAt: row.publishedAt?.toISOString() ?? null,
					transitionAction: row.transitionAction,
					transitionComments: row.transitionComments,
					restoredFromVersionNo: row.restoredFromVersionId
						? (versionNoById.get(row.restoredFromVersionId) ?? null)
						: null,
					isCurrentWorking,
					isCurrentPublished: row.id === item.currentPublishedVersionId,
					restorable:
						restoreAvailable && !isCurrentWorking && RESTORABLE_SOURCE_STATUSES.has(row.status),
					differences: isCurrentWorking ? [] : differencesBetween(fields, currentFields),
				}
			}) as ListPisoCampContentVersionsOutput["versions"],
		}
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
