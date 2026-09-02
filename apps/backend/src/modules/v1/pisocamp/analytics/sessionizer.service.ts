import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import { db } from "@/common/database/database.client"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"

const MANILA = "Asia/Manila"

@Injectable()
export class SessionizerService {
	constructor(private readonly adminConfig: PisoCampAdminConfigService) {}

	/**
	 * Rebuilds the sessions that start within a window of Asia/Manila days.
	 *
	 * Sessions are derived from the events themselves — a subject's events in
	 * order, cut wherever the gap reaches the configured inactivity — rather
	 * than from the client's `session_id`, which a device controls.
	 *
	 * Rebuilding replaces the window's rows, so a late upload is absorbed by
	 * running it again rather than by counting anybody twice. A session that
	 * began before the window is rebuilt with it: its events are part of the
	 * same run of activity, and cutting it at midnight would invent a session.
	 */
	async rebuild(input: { from: string; to: string }): Promise<{ sessions: number }> {
		const inactivityMinutes = (await this.adminConfig.get()).session_inactivity_minutes

		const result = await db.transaction(async tx => {
			// The window in absolute time: the Manila day boundaries, so a
			// session is attributed to the day a person actually started it.
			const bounds = sql`
				select
					((${input.from}::date)::timestamp at time zone ${MANILA}) as window_start,
					(((${input.to}::date + 1)::timestamp) at time zone ${MANILA}) as window_end
			`

			await tx.execute(sql`
				with bounds as (${bounds})
				delete from analytics_session
				using bounds
				where analytics_session.started_at >= bounds.window_start
					and analytics_session.started_at < bounds.window_end
			`)

			const inserted = await tx.execute<{ inserted: string }>(sql`
				with bounds as (${bounds}),
				-- Events from a little before the window too: a session that began
				-- yesterday evening is one session, not two.
				scoped as (
					select
						e.subject_pseudo_id,
						e.occurred_at,
						e.screen
					from analytics_event e, bounds
					where e.occurred_at >= bounds.window_start - interval '1 day'
						and e.occurred_at < bounds.window_end
				),
				gapped as (
					select
						subject_pseudo_id,
						occurred_at,
						screen,
						case
							when lag(occurred_at) over subject is null then 1
							when occurred_at - lag(occurred_at) over subject
								>= make_interval(mins => ${inactivityMinutes}) then 1
							else 0
						end as starts_session,
						case
							when lag(screen) over subject is distinct from screen then 1
							else 0
						end as changes_screen
					from scoped
					window subject as (partition by subject_pseudo_id order by occurred_at)
				),
				numbered as (
					select
						*,
						sum(starts_session) over (
							partition by subject_pseudo_id order by occurred_at
							rows between unbounded preceding and current row
						) as session_number
					from gapped
				),
				grouped as (
					select
						subject_pseudo_id,
						min(occurred_at) as started_at,
						max(occurred_at) as ended_at,
						count(*)::int as event_count,
						-- The first screen counts, and so does every change of it.
						greatest(sum(changes_screen)::int, 1) as screen_view_count
					from numbered
					group by subject_pseudo_id, session_number
				)
				insert into analytics_session (
					subject_pseudo_id, started_at, ended_at, local_date,
					duration_seconds, event_count, screen_view_count
				)
				select
					g.subject_pseudo_id,
					g.started_at,
					g.ended_at,
					(g.started_at at time zone ${MANILA})::date,
					floor(extract(epoch from (g.ended_at - g.started_at)))::int,
					g.event_count,
					least(g.screen_view_count, g.event_count)
				from grouped g, bounds
				where g.started_at >= bounds.window_start and g.started_at < bounds.window_end
				returning 1 as inserted
			`)

			return inserted.rows.length
		})

		return { sessions: result }
	}
}
