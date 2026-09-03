import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import type { PisoCampProgress } from "@repo/contracts/pisocamp-progress"

import { db } from "@/common/database/database.client"

@Injectable()
export class PisoCampProgressService {
	/**
	 * One person's own progress, computed from what they actually did.
	 *
	 * Two sources, because the module records two different things: the trivia
	 * answers are keyed to the account, and the content views are keyed to the
	 * device pseudonym analytics uses. The link between them is F3's
	 * device-account link — the same one SA-7 deletes on erasure, which is why
	 * deleting it is what makes the analytics safe to keep.
	 */
	async forAccount(accountId: string): Promise<PisoCampProgress> {
		const [trivia] = (
			await db.execute<{
				topicsAnswered: string
				answered: string
				correct: string
				skipped: string
				points: string
				lastAt: string | null
			}>(sql`
				select
					count(distinct content_item_id)::text as "topicsAnswered",
					count(*) filter (where skipped is false)::text as "answered",
					count(*) filter (where correct)::text as "correct",
					count(*) filter (where skipped)::text as "skipped",
					coalesce(sum(points), 0)::text as "points",
					max(answered_at) as "lastAt"
				from trivia_response
				where account_id = ${accountId}
			`)
		).rows

		const [views] = (
			await db.execute<{ topicsViewed: string; lastAt: string | null }>(sql`
				select
					count(distinct e.properties->>'logicalId')::text as "topicsViewed",
					max(e.occurred_at) as "lastAt"
				from analytics_event e
				join piso_camp_device_account_link l
					on l.device_pseudo_id = e.subject_pseudo_id
				where l.account_id = ${accountId}
					and e.event_name = 'content_view'
			`)
		).rows

		const answered = Number(trivia?.answered ?? 0)
		const correct = Number(trivia?.correct ?? 0)
		const lastActivity = latest(trivia?.lastAt ?? null, views?.lastAt ?? null)

		return {
			topicsViewed: Number(views?.topicsViewed ?? 0),
			topicsAnswered: Number(trivia?.topicsAnswered ?? 0),
			questionsAnswered: answered,
			questionsCorrect: correct,
			questionsSkipped: Number(trivia?.skipped ?? 0),
			// Skipped questions are not wrong answers, so they stay out of the
			// denominator — otherwise skipping would look like failing.
			accuracyPercent: answered === 0 ? 0 : Math.round((correct / answered) * 10_000) / 100,
			points: Number(trivia?.points ?? 0),
			lastActivityAt: lastActivity,
		}
	}
}

/** The later of two moments, either of which may not have happened. */
function latest(a: string | Date | null, b: string | Date | null): string | null {
	const times = [a, b]
		.filter((value): value is string | Date => value !== null)
		.map(value => new Date(value))
	if (times.length === 0) return null
	return new Date(Math.max(...times.map(time => time.getTime()))).toISOString()
}
