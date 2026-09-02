import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, count, desc, eq, gte, inArray, lte, or, type SQL } from "drizzle-orm"

import type {
	ListPisoCampContentAuditInput,
	ListPisoCampContentAuditOutput,
	PisoCampContentAuditAction,
	PisoCampContentAuditEntry,
} from "@repo/contracts"
import { PISO_CAMP_CONTENT_AUDIT_ACTIONS } from "@repo/contracts/pisocamp-content-audit"
import { auditLog, contentItems, contentVersions, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

const AUDITABLE_ACTIONS = new Set<string>(PISO_CAMP_CONTENT_AUDIT_ACTIONS)
const CONTENT_STATUSES = new Set([
	"draft",
	"submitted_for_review",
	"approved",
	"published",
	"unpublished",
	"deactivated",
	"archived",
])

function readString(value: unknown, key: string): string | null {
	if (typeof value !== "object" || value === null) return null
	const candidate = (value as Record<string, unknown>)[key]
	return typeof candidate === "string" ? candidate : null
}

function readNumber(value: unknown, key: string): number | null {
	if (typeof value !== "object" || value === null) return null
	const candidate = (value as Record<string, unknown>)[key]
	return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0
		? candidate
		: null
}

function readState(value: unknown, key: string): PisoCampContentAuditEntry["fromState"] {
	const candidate = readString(value, key)
	return candidate !== null && CONTENT_STATUSES.has(candidate)
		? (candidate as PisoCampContentAuditEntry["fromState"])
		: null
}

/**
 * CM-7 per-item audit history.
 *
 * Read-only over the append-only trail every content ticket already writes to.
 * Nothing here inserts, and nothing reads any table but `audit_log` and the
 * item's own versions — the trail is evidence precisely because the screen that
 * shows it cannot shape it.
 */
@Injectable()
export class ContentAuditService {
	async list(input: ListPisoCampContentAuditInput): Promise<ListPisoCampContentAuditOutput> {
		const page = Number(input.page ?? 1)
		const limit = Number(input.limit ?? 25)

		const [item] = await db
			.select({ id: contentItems.id })
			.from(contentItems)
			.where(eq(contentItems.id, input.itemId))
		if (!item) throw new ORPCError("NOT_FOUND", { message: "Content item not found" })

		// An item's trail is written against the item and, for version-scoped
		// actions such as CM-5 preview, against its versions. Both belong to the
		// same history.
		const versionIds = (
			await db
				.select({ id: contentVersions.id })
				.from(contentVersions)
				.where(eq(contentVersions.itemId, item.id))
		).map(row => row.id)

		const scope = versionIds.length
			? or(
					and(eq(auditLog.targetType, "content_item"), eq(auditLog.targetId, item.id)),
					and(eq(auditLog.targetType, "content_version"), inArray(auditLog.targetId, versionIds))
				)
			: and(eq(auditLog.targetType, "content_item"), eq(auditLog.targetId, item.id))

		const filters: (SQL | undefined)[] = [
			scope,
			eq(auditLog.domain, "content"),
			eq(auditLog.outcome, "success"),
			input.actorId ? eq(auditLog.actorId, input.actorId) : undefined,
			input.action ? eq(auditLog.action, input.action) : undefined,
			input.from ? gte(auditLog.createdAt, new Date(input.from)) : undefined,
			input.to ? lte(auditLog.createdAt, new Date(input.to)) : undefined,
		]
		const where = and(...filters)

		const [totals] = await db.select({ total: count() }).from(auditLog).where(where)

		const rows = await db
			.select({
				id: auditLog.id,
				action: auditLog.action,
				actorId: auditLog.actorId,
				actorName: users.name,
				oldValue: auditLog.oldValue,
				newValue: auditLog.newValue,
				createdAt: auditLog.createdAt,
			})
			.from(auditLog)
			// Left join: an entry outlives the account that produced it, by design.
			.leftJoin(users, eq(auditLog.actorId, users.id))
			.where(where)
			.orderBy(desc(auditLog.createdAt), desc(auditLog.id))
			.limit(limit)
			.offset((page - 1) * limit)

		const actorRows = await db
			.selectDistinct({ id: users.id, name: users.name })
			.from(auditLog)
			.innerJoin(users, eq(auditLog.actorId, users.id))
			.where(and(scope, eq(auditLog.domain, "content"), eq(auditLog.outcome, "success")))
			.orderBy(asc(users.name))
			.limit(200)

		return {
			itemId: item.id,
			page,
			limit,
			total: totals?.total ?? 0,
			actors: actorRows,
			entries: rows
				// A row whose action this view cannot explain is dropped rather than
				// rendered as an unlabelled mystery; the closed action list is the
				// contract with the screen.
				.filter(row => AUDITABLE_ACTIONS.has(row.action))
				.map(row => ({
					id: row.id,
					action: row.action as PisoCampContentAuditAction,
					fromState: readState(row.oldValue, "fromState"),
					toState: readState(row.newValue, "toState"),
					versionNo:
						readNumber(row.newValue, "targetVersionNo") ?? readNumber(row.newValue, "versionNo"),
					comments: readString(row.newValue, "comments"),
					actor: row.actorId && row.actorName ? { id: row.actorId, name: row.actorName } : null,
					at: row.createdAt.toISOString(),
				})),
		}
	}
}
