import { Injectable } from "@nestjs/common"
import { sql, type SQL } from "drizzle-orm"

import type {
	DemographicDimension,
	DemographicDistribution,
	DemographicDrilldown,
	DemographicMeasure,
	DemographicsSummary,
} from "@repo/contracts/pisocamp-demographics"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

import { PisoCampAdminConfigService } from "../pisocamp-admin-config.service"

const MANILA = "Asia/Manila"

const GENDER_LABELS: Record<string, string> = {
	female: "Female",
	male: "Male",
	prefer_not_to_say: "Prefer not to say",
}

type CountedRow = {
	key: string
	label: string
	users: string
}

type MeasuredRow = CountedRow & { value: string }

@Injectable()
export class DemographicsService {
	constructor(
		private readonly adminConfig: PisoCampAdminConfigService,
		private readonly audit: AuditService
	) {}

	/**
	 * Demographic cuts of usage and retention, scoped by consent (RF-3).
	 *
	 * Only a profile whose account granted `demographic_analytics` appears in
	 * any cut here. That consent is what makes the analysis lawful, so it is the
	 * join, not a filter somebody can forget to apply.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["demographics"]
	): Promise<DemographicsSummary> {
		const config = await this.adminConfig.get()
		const minimum = config.suppression_minimum
		const buckets = config.age_group_buckets

		const ageGroupExpression = this.ageGroupExpression(buckets)
		const consented = this.consentedProfiles(ageGroupExpression)

		const [totals] = (
			await db.execute<{ consented: string; without: string }>(sql`
				with consented as (${consented})
				select
					(select count(*)::text from consented) as "consented",
					(
						select count(*)::text from piso_camp_profile p
						where not exists (select 1 from consented c where c.account_id = p.account_id)
					) as "without"
			`)
		).rows

		const distributions: DemographicDistribution[] = []
		for (const dimension of ["ageGroup", "gender", "region", "city"] as const) {
			distributions.push(
				this.distribution(
					dimension,
					await this.countBy(consented, dimension),
					minimum,
					Number(totals?.consented ?? 0)
				)
			)
		}

		const dauByGender = this.measure(
			"gender",
			"users",
			await this.activeUsersBy(consented, "gender", input),
			minimum
		)
		const sessionDurationByGender = this.measure(
			"gender",
			"seconds",
			await this.sessionDurationBy(consented, "gender", input),
			minimum
		)

		const retention: DemographicMeasure[] = []
		for (const dimension of ["ageGroup", "gender", "region", "city"] as const) {
			retention.push(
				this.measure(
					dimension,
					"percent",
					await this.retentionBy(consented, dimension, input),
					minimum
				)
			)
		}

		const churn: DemographicMeasure[] = []
		for (const dimension of ["region", "city"] as const) {
			churn.push(
				this.measure(
					dimension,
					"percent",
					await this.churnBy(consented, dimension, input, config.churn_inactivity_days),
					minimum
				)
			)
		}

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			suppressionMinimum: minimum,
			consentedUsers: Number(totals?.consented ?? 0),
			withoutConsentUsers: Number(totals?.without ?? 0),
			distributions,
			dauByGender,
			sessionDurationByGender,
			retention,
			churn,
		}
	}

	/**
	 * §4.2-M's drill-down, for a holder of `reports.pii.view` only.
	 *
	 * Audited on the way out, because reading who is in a group is a different
	 * act from reading how many people are in it, and only one of them needs to
	 * be answerable for later.
	 */
	async drilldown(
		input: V1Inputs["pisocamp"]["analytics"]["demographicDrilldown"],
		actorId: string
	): Promise<DemographicDrilldown> {
		const config = await this.adminConfig.get()
		const consented = this.consentedProfiles(this.ageGroupExpression(config.age_group_buckets))
		const column = this.dimensionColumn(input.dimension)

		const rows = (
			await db.execute<{
				accountId: string
				name: string
				email: string
				gender: "female" | "male" | "prefer_not_to_say"
				age: number
				regionCode: string
				cityCode: string
				activeDays: string
				lastActiveDate: string | null
			}>(sql`
				with consented as (${consented}), scoped as (
					select * from consented where ${column} = ${input.bucketKey}
				), activity as (
					select
						l.account_id,
						count(distinct s.local_date)::text as active_days,
						max(s.local_date)::text as last_active_date
					from analytics_session s
					join piso_camp_device_account_link l
						on l.device_pseudo_id = s.subject_pseudo_id
					where s.local_date between ${input.from}::date and ${input.to}::date
					group by l.account_id
				)
				select
					c.account_id as "accountId",
					u.name as "name",
					u.email as "email",
					c.gender as "gender",
					c.age as "age",
					c.region_code as "regionCode",
					c.city_code as "cityCode",
					coalesce(a.active_days, '0') as "activeDays",
					a.last_active_date as "lastActiveDate"
				from scoped c
				join users u on u.id = c.account_id
				left join activity a on a.account_id = c.account_id
				order by u.name, c.account_id
				limit ${input.limit}
			`)
		).rows

		const [total] = (
			await db.execute<{ users: string }>(sql`
				with consented as (${consented})
				select count(*)::text as "users" from consented where ${column} = ${input.bucketKey}
			`)
		).rows

		await this.audit.record({
			domain: "pisocamp",
			action: "demographics.pii_view",
			actorId,
			targetType: "demographic_bucket",
			targetId: `${input.dimension}:${input.bucketKey}`,
			newValue: {
				from: input.from,
				to: input.to,
				rowsReturned: rows.length,
				totalUsers: Number(total?.users ?? 0),
			},
		})

		return {
			dimension: input.dimension,
			bucketKey: input.bucketKey,
			from: input.from,
			to: input.to,
			totalUsers: Number(total?.users ?? 0),
			rows: rows.map(row => ({
				accountId: row.accountId,
				name: row.name,
				email: row.email,
				gender: row.gender,
				age: row.age,
				regionCode: row.regionCode,
				cityCode: row.cityCode,
				activeDays: Number(row.activeDays),
				lastActiveDate: row.lastActiveDate,
			})),
		}
	}

	/**
	 * The consented population: profiles whose account granted
	 * `demographic_analytics` and has not withdrawn it.
	 *
	 * The latest response per account decides, because consent is a thing people
	 * change their minds about and only the current answer is the lawful one.
	 */
	private consentedProfiles(ageGroup: SQL): SQL {
		return sql`
			select
				p.account_id,
				p.gender,
				p.age,
				p.region_code,
				p.city_code,
				${ageGroup} as age_group
			from piso_camp_profile p
			join lateral (
				select status
				from consent_record c
				where c.account_id = p.account_id and c.purpose = 'demographic_analytics'
				order by c.responded_at desc, c.recorded_at desc
				limit 1
			) latest on true
			where latest.status = 'granted'
		`
	}

	/** The configured age buckets, as a CASE that labels each age. */
	private ageGroupExpression(buckets: { minAge: number; maxAge: number | null }[]): SQL {
		const branches = buckets.map(bucket => {
			const label = bucket.maxAge === null ? `${bucket.minAge}+` : `${bucket.minAge}-${bucket.maxAge}`
			return bucket.maxAge === null
				? sql`when p.age >= ${bucket.minAge} then ${label}`
				: sql`when p.age between ${bucket.minAge} and ${bucket.maxAge} then ${label}`
		})
		return sql`case ${sql.join(branches, sql` `)} else 'Unknown' end`
	}

	private dimensionColumn(dimension: DemographicDimension): SQL {
		switch (dimension) {
			case "ageGroup":
				return sql.raw("age_group")
			case "gender":
				return sql.raw("gender")
			case "region":
				return sql.raw("region_code")
			case "city":
				return sql.raw("city_code")
		}
	}

	private async countBy(
		consented: SQL,
		dimension: DemographicDimension
	): Promise<CountedRow[]> {
		const column = this.dimensionColumn(dimension)
		return (
			await db.execute<CountedRow>(sql`
				with consented as (${consented})
				select ${column} as "key", ${column} as "label", count(*)::text as "users"
				from consented
				group by ${column}
				order by ${column}
			`)
		).rows
	}

	/** Distinct active users in the range, by dimension. */
	private async activeUsersBy(
		consented: SQL,
		dimension: DemographicDimension,
		input: { from: string; to: string }
	) {
		const column = this.dimensionColumn(dimension)
		return (
			await db.execute<MeasuredRow>(sql`
				with consented as (${consented}), active as (
					select distinct l.account_id, s.local_date
					from analytics_session s
					join piso_camp_device_account_link l
						on l.device_pseudo_id = s.subject_pseudo_id
					where s.local_date between ${input.from}::date and ${input.to}::date
				)
				select
					c.${column} as "key",
					c.${column} as "label",
					count(distinct c.account_id)::text as "users",
					-- Daily active users: the average over the days in the range,
					-- because "DAU" is a per-day figure and summing days would
					-- count the same person once per visit.
					(count(*)::numeric / greatest(1, (${input.to}::date - ${input.from}::date + 1)))::text
						as "value"
				from consented c
				join active a on a.account_id = c.account_id
				group by c.${column}
				order by c.${column}
			`)
		).rows
	}

	private async sessionDurationBy(
		consented: SQL,
		dimension: DemographicDimension,
		input: { from: string; to: string }
	) {
		const column = this.dimensionColumn(dimension)
		return (
			await db.execute<MeasuredRow>(sql`
				with consented as (${consented})
				select
					c.${column} as "key",
					c.${column} as "label",
					count(distinct c.account_id)::text as "users",
					avg(s.duration_seconds)::text as "value"
				from consented c
				join piso_camp_device_account_link l on l.account_id = c.account_id
				join analytics_session s on s.subject_pseudo_id = l.device_pseudo_id
					and s.local_date between ${input.from}::date and ${input.to}::date
				group by c.${column}
				order by c.${column}
			`)
		).rows
	}

	/**
	 * Day-7 retention by dimension: of the people first seen in the range, how
	 * many came back on the seventh day or later.
	 */
	private async retentionBy(
		consented: SQL,
		dimension: DemographicDimension,
		input: { from: string; to: string }
	) {
		const column = this.dimensionColumn(dimension)
		return (
			await db.execute<MeasuredRow>(sql`
				with consented as (${consented}), lifespans as (
					select
						l.account_id,
						min(s.local_date) as first_day,
						max(s.local_date) as last_day
					from analytics_session s
					join piso_camp_device_account_link l
						on l.device_pseudo_id = s.subject_pseudo_id
					where s.local_date <= ${input.to}::date
					group by l.account_id
				), cohort as (
					select
						f.account_id,
						f.first_day,
						exists (
							select 1
							from analytics_session s2
							join piso_camp_device_account_link l2
								on l2.device_pseudo_id = s2.subject_pseudo_id
							where l2.account_id = f.account_id
								and s2.local_date >= f.first_day + 7
								and s2.local_date <= ${input.to}::date
						) as returned
					from lifespans f
					where f.first_day between ${input.from}::date and ${input.to}::date
				)
				select
					c.${column} as "key",
					c.${column} as "label",
					count(*)::text as "users",
					(count(*) filter (where h.returned)::numeric * 100 / greatest(1, count(*)))::text
						as "value"
				from consented c
				join cohort h on h.account_id = c.account_id
				group by c.${column}
				order by c.${column}
			`)
		).rows
	}

	/** Churn: known people whose last active day is older than the configured quiet period. */
	private async churnBy(
		consented: SQL,
		dimension: DemographicDimension,
		input: { from: string; to: string },
		inactivityDays: number
	) {
		const column = this.dimensionColumn(dimension)
		return (
			await db.execute<MeasuredRow>(sql`
				with consented as (${consented}), lifespans as (
					select l.account_id, max(s.local_date) as last_day
					from analytics_session s
					join piso_camp_device_account_link l
						on l.device_pseudo_id = s.subject_pseudo_id
					where s.local_date <= ${input.to}::date
					group by l.account_id
				)
				select
					c.${column} as "key",
					c.${column} as "label",
					count(*)::text as "users",
					(
						count(*) filter (
							where f.last_day < ${input.to}::date - make_interval(days => ${inactivityDays})
						)::numeric * 100 / greatest(1, count(*))
					)::text as "value"
				from consented c
				join lifespans f on f.account_id = c.account_id
				group by c.${column}
				order by c.${column}
			`)
		).rows
	}

	/**
	 * Apply the suppression floor to a distribution.
	 *
	 * A suppressed bucket keeps its label and loses its figures: "fewer than the
	 * minimum" is itself the finding, and dropping the row would read as nobody
	 * at all.
	 */
	private distribution(
		dimension: DemographicDimension,
		rows: CountedRow[],
		minimum: number,
		total: number
	): DemographicDistribution {
		let suppressed = 0
		const buckets = rows.map(row => {
			const users = Number(row.users)
			const hide = users < minimum
			if (hide) suppressed += 1
			return {
				key: row.key,
				label: this.label(dimension, row.label),
				suppressed: hide,
				users: hide ? null : users,
				percent: hide ? null : total === 0 ? 0 : Math.round((users / total) * 10_000) / 100,
			}
		})

		return { dimension, buckets, totalUsers: total, suppressedBuckets: suppressed }
	}

	private measure(
		dimension: DemographicDimension,
		unit: "users" | "seconds" | "percent",
		rows: MeasuredRow[],
		minimum: number
	): DemographicMeasure {
		let suppressed = 0
		const mapped = rows.map(row => {
			const users = Number(row.users)
			const hide = users < minimum
			if (hide) suppressed += 1
			return {
				key: row.key,
				label: this.label(dimension, row.label),
				suppressed: hide,
				users: hide ? null : users,
				value: hide ? null : Math.round(Number(row.value) * 100) / 100,
			}
		})

		return { dimension, unit, rows: mapped, suppressedRows: suppressed }
	}

	private label(dimension: DemographicDimension, key: string): string {
		return dimension === "gender" ? (GENDER_LABELS[key] ?? key) : key
	}
}
