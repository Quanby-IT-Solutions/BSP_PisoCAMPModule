import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

import type {
	PisoCampContentDetail,
	PisoCampContentDraft,
	PisoCampContentSummary,
	PisoCampRelatedLinkInput,
	PisoCampRelatedLinkOutput,
} from "@repo/contracts"
import {
	contentItems,
	contentVersions,
	pisoCampCurrencyDenominations,
	pisoCampCurrencySeries,
	relatedLinks,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import {
	databaseTransactionContext,
	type DatabaseTransaction,
} from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

import { copyVersionAssets } from "../assets/version-assets"
import {
	fromContentVersion,
	getContentDetail,
	selectContentLinks,
	toContentVersionValues,
} from "./content-mapping"

type CreateInput = V1Inputs["pisocamp"]["admin"]["content"]["create"]
type UpdateInput = V1Inputs["pisocamp"]["admin"]["content"]["update"]
type ListInput = V1Inputs["pisocamp"]["admin"]["content"]["list"]
type ContentDb = typeof db | DatabaseTransaction

const creator = alias(users, "content_creator")
const editor = alias(users, "content_editor")

@Injectable()
export class ContentService {
	constructor(private readonly auditService: AuditService) {}

	async create(input: CreateInput, actorId: string): Promise<PisoCampContentDetail> {
		return databaseTransactionContext.transaction(async tx => {
			await this.validateReferences(tx, input.content, input.relatedLinks)
			const itemId = randomUUID()
			const versionId = randomUUID()
			await tx.insert(contentItems).values({
				id: itemId,
				contentType: input.content.contentType,
				status: "draft",
				createdBy: actorId,
				lastEditedBy: actorId,
			})
			await tx.insert(contentVersions).values({
				id: versionId,
				itemId,
				versionNo: 1,
				status: "draft",
				createdBy: actorId,
				...this.toVersionValues(input.content),
			})
			await this.insertLinks(tx, versionId, input.relatedLinks)
			await tx
				.update(contentItems)
				.set({ currentWorkingVersionId: versionId })
				.where(eq(contentItems.id, itemId))
			await this.auditService.record(
				{
					domain: "content",
					action: "content.create",
					actorId,
					targetType: "content_item",
					targetId: itemId,
					newValue: { itemId, versionId, versionNo: 1, contentType: input.content.contentType },
				},
				tx
			)
			return this.getDetail(tx, itemId)
		})
	}

	async update(input: UpdateInput, actorId: string): Promise<PisoCampContentDetail> {
		return databaseTransactionContext.transaction(async tx => {
			const [item] = await tx
				.select()
				.from(contentItems)
				.where(eq(contentItems.id, input.itemId))
				.for("update")
			if (!item) throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
			if (item.status !== "draft") {
				throw new ORPCError("CONFLICT", { message: "Only draft content can be edited" })
			}
			if (!item.currentWorkingVersionId) {
				throw new ORPCError("CONFLICT", { message: "Content item has no working version" })
			}
			const [current] = await tx
				.select()
				.from(contentVersions)
				.where(eq(contentVersions.id, item.currentWorkingVersionId))
			if (!current) throw new ORPCError("CONFLICT", { message: "Working version is missing" })
			if (current.versionNo !== input.expectedVersionNo) {
				throw new ORPCError("CONFLICT", { message: "Content was edited by another user" })
			}
			if (item.contentType !== input.content.contentType) {
				throw new ORPCError("BAD_REQUEST", { message: "Content type cannot be changed" })
			}
			await this.validateReferences(tx, input.content, input.relatedLinks)
			const oldLinks = await this.selectLinks(tx, current.id)
			const versionId = randomUUID()
			const versionNo = current.versionNo + 1
			await tx.insert(contentVersions).values({
				id: versionId,
				itemId: item.id,
				versionNo,
				parentVersionId: current.id,
				status: "draft",
				createdBy: actorId,
				...this.toVersionValues(input.content),
			})
			await copyVersionAssets(tx, {
				contentItemId: item.id,
				sourceVersionId: current.id,
				targetVersionId: versionId,
			})
			await this.insertLinks(tx, versionId, input.relatedLinks)
			await tx
				.update(contentItems)
				.set({ currentWorkingVersionId: versionId, lastEditedBy: actorId, updatedAt: new Date() })
				.where(eq(contentItems.id, item.id))
			const changedFields = this.changedFields(current, oldLinks, input.content, input.relatedLinks)
			await this.auditService.record(
				{
					domain: "content",
					action: "content.edit",
					actorId,
					targetType: "content_item",
					targetId: item.id,
					oldValue: { versionId: current.id, versionNo: current.versionNo },
					newValue: { versionId, versionNo, contentType: item.contentType, changedFields },
				},
				tx
			)
			return this.getDetail(tx, item.id)
		})
	}

	async get(itemId: string): Promise<PisoCampContentDetail> {
		return this.getDetail(db, itemId)
	}

	async list(input: ListInput) {
		const page = typeof input.page === "number" ? input.page : Number(input.page ?? 1)
		const limit = typeof input.limit === "number" ? input.limit : Number(input.limit ?? 20)
		const conditions = [
			input.contentType ? eq(contentItems.contentType, input.contentType) : undefined,
			input.status ? eq(contentItems.status, input.status) : undefined,
			input.seriesCode ? eq(contentVersions.seriesCode, input.seriesCode) : undefined,
			input.denominationCode
				? eq(contentVersions.denominationCode, input.denominationCode)
				: undefined,
			input.search
				? sql`to_tsvector('simple', ${contentVersions.title} || ' ' || ${contentVersions.summary}) @@ plainto_tsquery('simple', ${input.search})`
				: undefined,
		].filter(condition => condition !== undefined)
		const where = conditions.length ? and(...conditions) : undefined
		const base = {
			id: contentItems.id,
			contentType: contentItems.contentType,
			status: contentItems.status,
			title: contentVersions.title,
			currentVersionNo: contentVersions.versionNo,
			seriesCode: contentVersions.seriesCode,
			denominationCode: contentVersions.denominationCode,
			creatorId: creator.id,
			creatorName: creator.name,
			editorId: editor.id,
			editorName: editor.name,
			createdAt: contentItems.createdAt,
			dateModified: contentItems.updatedAt,
		}
		const rows = await db
			.select(base)
			.from(contentItems)
			.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
			.innerJoin(creator, eq(contentItems.createdBy, creator.id))
			.innerJoin(editor, eq(contentItems.lastEditedBy, editor.id))
			.where(where)
			.orderBy(desc(contentItems.updatedAt), asc(contentItems.id))
			.limit(limit)
			.offset((page - 1) * limit)
		const totals = await db
			.select({ total: count() })
			.from(contentItems)
			.innerJoin(contentVersions, eq(contentItems.currentWorkingVersionId, contentVersions.id))
			.where(where)
		return {
			items: rows.map(row => this.toSummary(row)),
			page,
			limit,
			total: totals[0]?.total ?? 0,
		}
	}

	private async getDetail(database: ContentDb, itemId: string): Promise<PisoCampContentDetail> {
		const detail = await getContentDetail(database, itemId)
		if (!detail) throw new ORPCError("NOT_FOUND", { message: "Content item not found" })
		return detail
	}

	private async validateReferences(
		tx: DatabaseTransaction,
		content: PisoCampContentDraft,
		links: PisoCampRelatedLinkInput[]
	): Promise<void> {
		if ("seriesCode" in content) {
			const [pair] = await tx
				.select({ mediaKind: pisoCampCurrencySeries.mediaKind })
				.from(pisoCampCurrencyDenominations)
				.innerJoin(
					pisoCampCurrencySeries,
					eq(pisoCampCurrencyDenominations.seriesCode, pisoCampCurrencySeries.code)
				)
				.where(
					and(
						eq(pisoCampCurrencyDenominations.seriesCode, content.seriesCode),
						eq(pisoCampCurrencyDenominations.code, content.denominationCode)
					)
				)
			const expected =
				content.contentType === "banknote"
					? "banknote"
					: content.contentType === "coin"
						? "coin"
						: undefined
			if (!pair || (expected && pair.mediaKind !== expected)) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Unknown or mismatched currency series and denomination",
				})
			}
		}
		const targets = [
			...new Set(links.flatMap(item => (item.kind === "topic" ? [item.targetContentItemId] : []))),
		]
		if (targets.length) {
			const found = await tx
				.select({ id: contentItems.id })
				.from(contentItems)
				.where(inArray(contentItems.id, targets))
			if (found.length !== targets.length) {
				throw new ORPCError("BAD_REQUEST", { message: "A related topic target does not exist" })
			}
		}
	}

	private toVersionValues(content: PisoCampContentDraft) {
		return toContentVersionValues(content)
	}

	private fromVersion(row: {
		contentType: PisoCampContentDraft["contentType"]
		title: string
		summary: string
		body: string | null
		seriesCode: string | null
		denominationCode: string | null
		primaryUrl: string | null
	}): PisoCampContentDraft {
		return fromContentVersion(row)
	}

	private async insertLinks(
		tx: DatabaseTransaction,
		versionId: string,
		links: PisoCampRelatedLinkInput[]
	) {
		if (!links.length) return
		await tx.insert(relatedLinks).values(
			links.map((item, position) => ({
				id: randomUUID(),
				contentVersionId: versionId,
				position,
				kind: item.kind,
				label: item.label,
				externalUrl: item.kind === "external" ? item.url : null,
				internalRoute: item.kind === "internal" ? item.route : null,
				targetContentItemId: item.kind === "topic" ? item.targetContentItemId : null,
			}))
		)
	}

	private async selectLinks(
		database: ContentDb,
		versionId: string
	): Promise<PisoCampRelatedLinkOutput[]> {
		return selectContentLinks(database, versionId)
	}

	private changedFields(
		current: typeof contentVersions.$inferSelect,
		oldLinks: PisoCampRelatedLinkOutput[],
		content: PisoCampContentDraft,
		newLinks: PisoCampRelatedLinkInput[]
	): string[] {
		const old = this.fromVersion(current)
		const names = [
			"body",
			"contentType",
			"denominationCode",
			"primaryUrl",
			"seriesCode",
			"summary",
			"title",
		]
		const changed = names.filter(
			name =>
				JSON.stringify((old as unknown as Record<string, unknown>)[name]) !==
				JSON.stringify((content as unknown as Record<string, unknown>)[name])
		)
		const normalizedOldLinks = oldLinks.map(item => {
			if (item.kind === "external") return { kind: item.kind, label: item.label, url: item.url }
			if (item.kind === "internal") return { kind: item.kind, label: item.label, route: item.route }
			return {
				kind: item.kind,
				label: item.label,
				targetContentItemId: item.targetContentItemId,
			}
		})
		if (JSON.stringify(normalizedOldLinks) !== JSON.stringify(newLinks))
			changed.push("relatedLinks")
		return changed.sort()
	}

	private toSummary(row: {
		id: string
		contentType: PisoCampContentSummary["contentType"]
		status: PisoCampContentSummary["status"]
		title: string
		currentVersionNo: number
		seriesCode: string | null
		denominationCode: string | null
		creatorId: string
		creatorName: string
		editorId: string
		editorName: string
		createdAt: Date
		dateModified: Date
	}): PisoCampContentSummary {
		const common = {
			id: row.id,
			contentType: row.contentType,
			status: row.status,
			title: row.title,
			currentVersionNo: row.currentVersionNo,
			creator: { id: row.creatorId, name: row.creatorName },
			lastEditor: { id: row.editorId, name: row.editorName },
			createdAt: row.createdAt.toISOString(),
			dateModified: row.dateModified.toISOString(),
		}
		if (row.contentType === "advisory" || row.contentType === "link")
			return common as PisoCampContentSummary
		return {
			...common,
			seriesCode: row.seriesCode!,
			denominationCode: row.denominationCode!,
		} as PisoCampContentSummary
	}
}
