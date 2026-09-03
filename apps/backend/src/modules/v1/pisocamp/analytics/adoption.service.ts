import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import { ADOPTION_FEATURES, KEY_ACTION_EVENTS } from "@repo/contracts/pisocamp-adoption"
import type { ReportFilters } from "@repo/contracts/pisocamp-report"

import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

import { eventFilters, eventRange } from "../reports/report-filters"

const MANILA = "Asia/Manila"

type Summary = V1Outputs["pisocamp"]["analytics"]["adoption"]
type Feature = (typeof ADOPTION_FEATURES)[number]

/**
 * How an event in the catalog maps onto an AN-013 feature.
 *
 * A `feature_use` already names its feature; the rest are named by what they
 * are. A feature nobody emits yet is still reported, with a zero: "not built"
 * and "not used" are different answers, and a missing row reads as the second.
 */
const FEATURE_SQL = sql`
	case
		when e.event_name = 'feature_use' and e.feature = '3d_coin' then '3d_coin'
		when e.event_name = 'feature_use' and e.feature = 'haptic' then 'haptic'
		when e.event_name = 'feature_use' and e.feature = 'tilt' then 'tilt'
		when e.event_name = 'content_view' and e.properties->>'logicalId' like '%banknote%'
			then 'banknotes'
		when e.event_name = 'content_view' and e.properties->>'logicalId' like '%coin%'
			then 'coins'
		when e.event_name = 'content_view' then 'currency_education'
		when e.event_name in ('trivia_prompt_shown', 'trivia_prompt_answered',
			'trivia_prompt_skipped') then 'trivia'
		when e.event_name in ('survey_prompt_shown', 'survey_declined', 'survey_submitted')
			then 'survey'
		when e.event_name = 'advisory_shown' then 'advisory'
		-- AR-1 and DR-1 report an attempt whether or not it could run, and only
		-- the ones that ran are uses of the feature: a phone that cannot open
		-- augmented reality, or a reader that was never downloaded, is not
		-- somebody using either. What broke is AN-7's question, not AN-013's.
		when e.event_name = 'ar_start' and e.properties->>'outcome' = 'started' then 'ar'
		when e.event_name = 'recognition_result' and e.status = 'completed' then 'recognition'
		when e.event_name = 'link_open' and e.properties->>'linkType' = 'external'
			then 'external_link'
		when e.event_name = 'link_open' then 'internal_link'
		else null
	end
`

@Injectable()
export class AdoptionService {
	/**
	 * Feature usage and the onboarding figures, for a range of Manila days.
	 *
	 * Everything is per **subject pseudo id**: a rate expressed per person has
	 * to divide by people, and the pseudo id is the only person-shaped thing
	 * analytics carries.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["adoption"] & { filters?: ReportFilters }
	): Promise<Summary> {
		const keyActionEvents = [...KEY_ACTION_EVENTS]
		// Interpolated one at a time: a JS array reaches PostgreSQL as a record,
		// which it will not cast to text[].
		const keyActionList = sql.join(
			keyActionEvents.map(name => sql`${name}`),
			sql`, `
		)
		// AN-8 runs this report with filters; the dashboard runs it without. One
		// predicate either way, so there is only one query to be right about.
		const range = sql`${eventRange(input.from, input.to)} and ${eventFilters(
			input.filters ?? {}
		)}`

		const [creation] = (
			await db.execute<{ prompted: string; registered: string }>(sql`
				select
					count(distinct e.subject_pseudo_id) filter (
						where e.event_name = 'account_prompt_shown'
					)::text as "prompted",
					count(distinct e.subject_pseudo_id) filter (
						where e.event_name = 'profile_created'
					)::text as "registered"
				from analytics_event e
				where ${range}
			`)
		).rows

		const [activation] = (
			await db.execute<{
				entered: string
				activated: string
				medianSeconds: string | null
				p95Seconds: string | null
			}>(sql`
				with entries as (
					select e.subject_pseudo_id, min(e.occurred_at) as first_entry
					from analytics_event e
					where ${range} and e.event_name = 'module_entry'
					group by e.subject_pseudo_id
				), key_actions as (
					select e.subject_pseudo_id, min(e.occurred_at) as first_action
					from analytics_event e
					where ${range} and e.event_name in (${keyActionList})
					group by e.subject_pseudo_id
				), joined as (
					select
						entries.subject_pseudo_id,
						entries.first_entry,
						key_actions.first_action,
						case
							-- Only an action after the entry is a time-to-action; an
							-- earlier one belongs to a visit before this range.
							when key_actions.first_action >= entries.first_entry
								then extract(epoch from (key_actions.first_action - entries.first_entry))
							else null
						end as seconds
					from entries
					left join key_actions using (subject_pseudo_id)
				)
				select
					count(*)::text as "entered",
					count(*) filter (where seconds is not null and seconds <= 86400)::text
						as "activated",
					percentile_cont(0.5) within group (order by seconds)::text as "medianSeconds",
					percentile_cont(0.95) within group (order by seconds)::text as "p95Seconds"
				from joined
			`)
		).rows

		const usage = (
			await db.execute<{ feature: Feature; uses: string; users: string }>(sql`
				select
					feature,
					count(*)::text as "uses",
					count(distinct subject_pseudo_id)::text as "users"
				from (
					select ${FEATURE_SQL} as feature, e.subject_pseudo_id
					from analytics_event e
					where ${range}
				) mapped
				where feature is not null
				group by feature
			`)
		).rows

		const byFeature = new Map(usage.map(row => [row.feature, row]))
		const prompted = Number(creation?.prompted ?? 0)
		const registered = Number(creation?.registered ?? 0)
		const entered = Number(activation?.entered ?? 0)
		const activated = Number(activation?.activated ?? 0)

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			keyActionEvents,
			promptedUsers: prompted,
			registeredUsers: registered,
			accountCreationRatePercent:
				prompted === 0 ? 0 : this.round((registered / prompted) * 100),
			timeToFirstKeyActionMedianSeconds: this.seconds(activation?.medianSeconds),
			timeToFirstKeyActionP95Seconds: this.seconds(activation?.p95Seconds),
			firstDayActivatedUsers: activated,
			enteredUsers: entered,
			firstDayActivationRatePercent:
				entered === 0 ? 0 : this.round((activated / entered) * 100),
			features: ADOPTION_FEATURES.map(feature => ({
				feature,
				uses: Number(byFeature.get(feature)?.uses ?? 0),
				users: Number(byFeature.get(feature)?.users ?? 0),
			})),
		}
	}

	/** Null rather than zero: nobody acted is not the same as acted instantly. */
	private seconds(value: string | null | undefined): number | null {
		if (value === null || value === undefined) return null
		const parsed = Number(value)
		return Number.isFinite(parsed) ? this.round(parsed) : null
	}

	private round(value: number): number {
		return Math.round(value * 100) / 100
	}
}
