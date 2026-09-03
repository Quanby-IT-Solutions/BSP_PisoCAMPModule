import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import type { GamificationSummary } from "@repo/contracts/pisocamp-gamification"

import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"

const MANILA = "Asia/Manila"

@Injectable()
export class GamificationService {
	constructor(private readonly adminConfig: PisoCampAdminConfigService) {}

	/**
	 * How well the gamification is working, for a range of Manila days.
	 *
	 * Reconciled against `trivia_response` and `leaderboard_entry` rather than
	 * against the events: a person's answers are what they actually did, and the
	 * events are only how it was reported.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["gamification"]
	): Promise<GamificationSummary> {
		const config = await this.adminConfig.get()
		const range = sql`
			e.occurred_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and e.occurred_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`
		const answeredRange = sql`
			r.answered_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and r.answered_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`

		const [participation] = (
			await db.execute<{
				eligible: string
				participating: string
				up: string
				down: string
				same: string
				fresh: string
			}>(sql`
				with board as (
					select account_id, rank_movement
					from leaderboard_entry
					where period_start >= ${input.from}::date and period_start <= ${input.to}::date
				)
				select
					-- Everybody who could take part: the board is offered to every
					-- registered account, and dividing by the players alone would
					-- report a rate that could never fall.
					(select count(*)::text from users) as "eligible",
					(select count(distinct account_id)::text from board) as "participating",
					(select count(*)::text from board where rank_movement > 0) as "up",
					(select count(*)::text from board where rank_movement < 0) as "down",
					(select count(*)::text from board where rank_movement = 0) as "same",
					(select count(*)::text from board where rank_movement is null) as "fresh"
			`)
		).rows

		const [top] = (
			await db.execute<{ previousTop: string; retained: string }>(sql`
				with periods as (
					select distinct period_type, period_start
					from leaderboard_entry
					where period_start <= ${input.to}::date
					order by period_start desc
					limit 2
				), ordered as (
					select period_type, period_start,
						row_number() over (order by period_start desc) as recency
					from periods
				), sized as (
					select
						o.recency,
						e.account_id,
						e.rank,
						count(*) over (partition by o.recency) as entries
					from ordered o
					join leaderboard_entry e
						on e.period_type = o.period_type and e.period_start = o.period_start
				), ranked as (
					select recency, account_id
					from sized
					where rank <= greatest(1, ceil(entries * ${config.leaderboard_top_group_percent} / 100.0))
				)
				select
					(select count(*)::text from ranked where recency = 2) as "previousTop",
					(
						select count(*)::text from ranked previous
						where previous.recency = 2
							and exists (
								select 1 from ranked current
								where current.recency = 1
									and current.account_id = previous.account_id
							)
					) as "retained"
			`)
		).rows

		const [counts] = (
			await db.execute<{ answered: string; skipped: string; correct: string }>(sql`
				select
					count(*) filter (where r.skipped is false)::text as "answered",
					count(*) filter (where r.skipped)::text as "skipped",
					count(*) filter (where r.correct)::text as "correct"
				from trivia_response r
				where ${answeredRange}
			`)
		).rows

		const [people] = (
			await db.execute<{ participants: string; repeats: string }>(sql`
				with days as (
					select
						r.account_id as account_id,
						((r.answered_at at time zone ${MANILA})::date) as local_date
					from trivia_response r
					where ${answeredRange}
					group by 1, 2
				)
				select
					count(distinct account_id)::text as "participants",
					-- Answered on more than one Manila day: coming back is what
					-- "repeat" means, not answering twice in one sitting.
					count(*) filter (where days_answered > 1)::text as "repeats"
				from (
					select account_id, count(*) as days_answered from days group by account_id
				) per_account
			`)
		).rows

		const [shown] = (
			await db.execute<{ shown: string }>(sql`
				select count(*)::text as "shown"
				from analytics_event e
				where ${range} and e.event_name = 'trivia_prompt_shown'
			`)
		).rows

		const [reengagement] = (
			await db.execute<{
				sessions: string
				returning: string
				views: string
				links: string
				prompts: string
			}>(sql`
				with trivia_moments as (
					select e.session_id, min(e.occurred_at) as first_trivia
					from analytics_event e
					where ${range}
						and e.event_name in ('trivia_prompt_shown', 'trivia_prompt_answered',
							'trivia_prompt_skipped')
					group by e.session_id
				), afterwards as (
					select
						t.session_id,
						count(*) filter (where e.event_name = 'content_view') as views,
						count(*) filter (where e.event_name = 'link_open') as links,
						-- Counted, but deliberately not part of the rate below: an
						-- engagement prompt is something the app did, not a return
						-- to the learning content.
						count(*) filter (where e.event_name = 'account_prompt_shown') as prompts
					from trivia_moments t
					join analytics_event e on e.session_id = t.session_id
						-- After, because the question is whether the trivia sent them
						-- back; something that happened first cannot have.
						and e.occurred_at > t.first_trivia
						and e.event_name in ('content_view', 'link_open',
							'account_prompt_shown')
					group by t.session_id
				)
				select
					(select count(*)::text from trivia_moments) as "sessions",
					(select count(*)::text from afterwards
						where views > 0 or links > 0) as "returning",
					(select coalesce(sum(views), 0)::text from afterwards) as "views",
					(select coalesce(sum(links), 0)::text from afterwards) as "links",
					(select coalesce(sum(prompts), 0)::text from afterwards) as "prompts"
			`)
		).rows

		const eligible = Number(participation?.eligible ?? 0)
		const participating = Number(participation?.participating ?? 0)
		const previousTop = Number(top?.previousTop ?? 0)
		const retainedTop = Number(top?.retained ?? 0)
		const answered = Number(counts?.answered ?? 0)
		const correct = Number(counts?.correct ?? 0)
		const promptsShown = Number(shown?.shown ?? 0)
		const participants = Number(people?.participants ?? 0)
		const repeats = Number(people?.repeats ?? 0)
		const sessionsWithTrivia = Number(reengagement?.sessions ?? 0)
		const returning = Number(reengagement?.returning ?? 0)

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			leaderboardEnabled: config.leaderboard_enabled,
			participation: {
				eligibleUsers: eligible,
				participatingUsers: participating,
				participationRatePercent: this.rate(participating, eligible),
				movedUp: Number(participation?.up ?? 0),
				movedDown: Number(participation?.down ?? 0),
				unchanged: Number(participation?.same ?? 0),
				newEntrants: Number(participation?.fresh ?? 0),
			},
			topPerformers: {
				topGroupPercent: config.leaderboard_top_group_percent,
				previousTopUsers: previousTop,
				retainedTopUsers: retainedTop,
				retentionRatePercent: this.rate(retainedTop, previousTop),
			},
			trivia: {
				promptsShown,
				answered,
				skipped: Number(counts?.skipped ?? 0),
				correct,
				incorrect: answered - correct,
				completionRatePercent: this.rate(answered, promptsShown),
				// Skips are not wrong answers, so they stay out of the denominator.
				accuracyPercent: this.rate(correct, answered),
				participants,
				repeatParticipants: repeats,
				repeatRatePercent: this.rate(repeats, participants),
			},
			reengagement: {
				sessionsWithTrivia,
				sessionsReturningToContent: returning,
				reengagementRatePercent: this.rate(returning, sessionsWithTrivia),
				contentViewsAfterTrivia: Number(reengagement?.views ?? 0),
				relatedLinkOpensAfterTrivia: Number(reengagement?.links ?? 0),
				engagementPromptsAfterTrivia: Number(reengagement?.prompts ?? 0),
			},
		}
	}

	/** Zero rather than a division by zero: an empty pool has no rate. */
	private rate(part: number, whole: number): number {
		if (whole === 0) return 0
		return Math.min(100, Math.round((part / whole) * 10_000) / 100)
	}
}
