import { createHash } from "node:crypto"
import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, sql } from "drizzle-orm"

import type {
	Leaderboard,
	LeaderboardPeriod,
	LeaderboardStanding,
} from "@repo/contracts/pisocamp-leaderboard"
import { leaderboardEntries, pisoCampProfiles } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"

const MANILA = "Asia/Manila"

/** All-time has no rolling start, so it is pinned to one day and stays there. */
const ALL_TIME_START = "2026-01-01"

@Injectable()
export class PisoCampLeaderboardService {
	constructor(private readonly adminConfig: PisoCampAdminConfigService) {}

	/**
	 * The Asia/Manila day a period contains `at` begins on.
	 *
	 * Weeks start on Monday, which is what "this week" means to the people
	 * reading it rather than what the epoch happens to imply.
	 */
	periodStart(period: LeaderboardPeriod, at: Date): string {
		if (period === "all_time") return ALL_TIME_START

		const manila = new Date(at.getTime() + 8 * 3_600_000)
		const year = manila.getUTCFullYear()
		const month = manila.getUTCMonth()
		const day = manila.getUTCDate()

		if (period === "monthly") {
			return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
		}

		const weekday = new Date(Date.UTC(year, month, day)).getUTCDay()
		// Sunday is 0, and a week that began "six days ago" would be next week's.
		const daysSinceMonday = (weekday + 6) % 7
		return new Date(Date.UTC(year, month, day - daysSinceMonday)).toISOString().slice(0, 10)
	}

	/** The period of the same kind immediately before this one. */
	previousPeriodStart(period: LeaderboardPeriod, periodStart: string): string | null {
		if (period === "all_time") return null

		const start = new Date(`${periodStart}T00:00:00Z`)
		if (period === "weekly") {
			return new Date(start.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
		}
		return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))
			.toISOString()
			.slice(0, 10)
	}

	/**
	 * Recompute one period from the trivia responses in it.
	 *
	 * Idempotent: it derives the whole period from `trivia_response` and replaces
	 * whatever it wrote before, so running it twice — or again after a late
	 * upload lands — leaves the same answer rather than doubling anybody's score.
	 */
	async rebuild(period: LeaderboardPeriod, at = new Date()): Promise<{ entries: number }> {
		const periodStart = this.periodStart(period, at)
		const previousStart = this.previousPeriodStart(period, periodStart)

		const scores = (
			await db.execute<{ accountId: string; score: string }>(sql`
				select r.account_id as "accountId", coalesce(sum(r.points), 0)::text as "score"
				from trivia_response r
				where ${this.periodWhere(period, periodStart)}
				group by r.account_id
				having coalesce(sum(r.points), 0) > 0
				order by coalesce(sum(r.points), 0) desc, r.account_id asc
			`)
		).rows

		const previous = new Map<string, number>()
		if (previousStart) {
			const rows = await db
				.select({ accountId: leaderboardEntries.accountId, rank: leaderboardEntries.rank })
				.from(leaderboardEntries)
				.where(
					and(
						eq(leaderboardEntries.periodType, period),
						eq(leaderboardEntries.periodStart, previousStart)
					)
				)
			for (const row of rows) previous.set(row.accountId, row.rank)
		}

		await db
			.delete(leaderboardEntries)
			.where(
				and(
					eq(leaderboardEntries.periodType, period),
					eq(leaderboardEntries.periodStart, periodStart)
				)
			)

		if (scores.length === 0) return { entries: 0 }

		// Equal scores share a rank, and the next rank skips: two people in
		// second place means nobody is third.
		let rank = 0
		let lastScore: number | null = null
		const rows = scores.map((row, index) => {
			const score = Number(row.score)
			if (score !== lastScore) {
				rank = index + 1
				lastScore = score
			}
			const before = previous.get(row.accountId)
			return {
				periodType: period,
				periodStart,
				accountId: row.accountId,
				score,
				rank,
				// Null, not zero: nobody to compare with is not "held station".
				rankMovement: before === undefined ? null : before - rank,
			}
		})

		await db.insert(leaderboardEntries).values(rows)
		return { entries: rows.length }
	}

	/**
	 * The board for one period, and where the person asking stands on it.
	 *
	 * Refuses outright when the leaderboard is switched off: a disabled feature
	 * that still answered would be a feature, and the flag would be decoration.
	 */
	async forAccount(
		accountId: string,
		period: LeaderboardPeriod,
		at = new Date()
	): Promise<Leaderboard> {
		const config = await this.adminConfig.get()
		if (!config.leaderboard_enabled) {
			throw new ORPCError("NOT_FOUND", { message: "The leaderboard is not available" })
		}

		const periodStart = this.periodStart(period, at)
		const rows = await db
			.select({
				accountId: leaderboardEntries.accountId,
				score: leaderboardEntries.score,
				rank: leaderboardEntries.rank,
				rankMovement: leaderboardEntries.rankMovement,
				alias: pisoCampProfiles.leaderboardAlias,
			})
			.from(leaderboardEntries)
			.leftJoin(
				pisoCampProfiles,
				eq(pisoCampProfiles.accountId, leaderboardEntries.accountId)
			)
			.where(
				and(
					eq(leaderboardEntries.periodType, period),
					eq(leaderboardEntries.periodStart, periodStart)
				)
			)
			.orderBy(asc(leaderboardEntries.rank))
			.limit(100)

		const standing = (row: (typeof rows)[number]): LeaderboardStanding => ({
			rank: row.rank,
			alias: row.alias ?? generatedAlias(row.accountId),
			score: row.score,
			rankMovement: row.rankMovement,
		})

		const mine = rows.find(row => row.accountId === accountId)

		return {
			period,
			periodStart,
			timezone: MANILA,
			top: rows.map(standing),
			// Their own row even when they are outside the top: a board that only
			// shows the leaders tells everybody else nothing about themselves.
			you: mine ? standing(mine) : await this.ownStanding(accountId, period, periodStart),
		}
	}

	/** Choose the name shown. Nothing else about the person is ever shown. */
	async setAlias(accountId: string, alias: string): Promise<{ alias: string }> {
		const updated = await db
			.update(pisoCampProfiles)
			.set({ leaderboardAlias: alias })
			.where(eq(pisoCampProfiles.accountId, accountId))
			.returning()

		if (updated.length === 0) {
			throw new ORPCError("NOT_FOUND", {
				message: "Complete your profile before choosing a leaderboard name",
			})
		}
		return { alias }
	}

	private async ownStanding(
		accountId: string,
		period: LeaderboardPeriod,
		periodStart: string
	): Promise<LeaderboardStanding | null> {
		const [row] = await db
			.select({
				score: leaderboardEntries.score,
				rank: leaderboardEntries.rank,
				rankMovement: leaderboardEntries.rankMovement,
				alias: pisoCampProfiles.leaderboardAlias,
			})
			.from(leaderboardEntries)
			.leftJoin(
				pisoCampProfiles,
				eq(pisoCampProfiles.accountId, leaderboardEntries.accountId)
			)
			.where(
				and(
					eq(leaderboardEntries.periodType, period),
					eq(leaderboardEntries.periodStart, periodStart),
					eq(leaderboardEntries.accountId, accountId)
				)
			)

		if (!row) return null
		return {
			rank: row.rank,
			alias: row.alias ?? generatedAlias(accountId),
			score: row.score,
			rankMovement: row.rankMovement,
		}
	}

	private periodWhere(period: LeaderboardPeriod, periodStart: string) {
		if (period === "all_time") return sql`true`

		const end =
			period === "weekly"
				? sql`(${periodStart}::date + 7)`
				: sql`(${periodStart}::date + interval '1 month')::date`

		return sql`
			r.answered_at >= ((${periodStart}::date)::timestamp at time zone ${MANILA})
			and r.answered_at < ((${end})::timestamp at time zone ${MANILA})
		`
	}
}

/**
 * The name somebody gets when they have not chosen one.
 *
 * Derived from the account id by hash, so it is stable across periods — a
 * leaderboard where the same person appeared under a different name each week
 * would be unreadable — and carries nothing of the account it came from.
 */
export function generatedAlias(accountId: string): string {
	const digest = createHash("sha256").update(accountId).digest("hex")
	return `Learner-${digest.slice(0, 6).toUpperCase()}`
}
