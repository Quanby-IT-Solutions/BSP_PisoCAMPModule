import { Injectable } from "@nestjs/common"
import { sql } from "drizzle-orm"

import type {
	NpsBreakdown,
	ScaleDistributionPoint,
	SurveyMetricsSummary,
	SurveyQuestionMetric,
} from "@repo/contracts/pisocamp-survey-metrics"

import { db } from "@/common/database/database.client"
import type { V1Inputs } from "@/config/contract-types"

import { CONTENT_LOGICAL_ID_PREFIX } from "../bundle/bundle-renderer"

const MANILA = "Asia/Manila"

type QuestionRow = {
	contentItemId: string
	questionId: string
	position: number
	kind: "rating" | "nps" | "text"
	prompt: string
	required: boolean
	scaleMin: number | null
	scaleMax: number | null
	npsPromoterMin: number | null
	npsPassiveMin: number | null
	answered: string
	skipped: string
	total: string | null
	promoters: string
	passives: string
	detractors: string
}

@Injectable()
export class SurveyMetricsService {
	/**
	 * Survey results for a range of Asia/Manila days.
	 *
	 * Counted from `survey_response` and `survey_answer` rather than from the
	 * events: EV-005 asks the report to reconcile with the responses, and a
	 * report built on the reports of answers cannot do that.
	 */
	async summary(
		input: V1Inputs["pisocamp"]["analytics"]["surveys"]
	): Promise<SurveyMetricsSummary> {
		const submitted = sql`
			r.submitted_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and r.submitted_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`
		const occurred = sql`
			e.occurred_at >= ((${input.from}::date)::timestamp at time zone ${MANILA})
			and e.occurred_at < (((${input.to}::date + 1)::timestamp) at time zone ${MANILA})
		`

		const responses = (
			await db.execute<{
				contentItemId: string
				title: string
				responses: string
				granted: string
				withdrawn: string
			}>(sql`
				select
					r.content_item_id as "contentItemId",
					max(v.title) as "title",
					count(*)::text as "responses",
					count(*) filter (where c.status = 'granted')::text as "granted",
					count(*) filter (where c.status = 'withdrawn')::text as "withdrawn"
				from survey_response r
				join consent_record c on c.id = r.consent_record_id
				join content_version v on v.id = r.content_version_id
				where ${submitted}
				group by r.content_item_id
			`)
		).rows

		const questions = (
			await db.execute<QuestionRow>(sql`
				with scoped as (
					select r.response_id, r.content_item_id, r.content_version_id
					from survey_response r
					where ${submitted}
				)
				select
					q.content_item_id as "contentItemId",
					q.id as "questionId",
					q.position as "position",
					q.kind as "kind",
					q.prompt as "prompt",
					q.required as "required",
					q.scale_min as "scaleMin",
					q.scale_max as "scaleMax",
					q.nps_promoter_min as "npsPromoterMin",
					q.nps_passive_min as "npsPassiveMin",
					count(a.id) filter (where a.skipped is false)::text as "answered",
					count(a.id) filter (where a.skipped)::text as "skipped",
					sum(a.scale_value)::text as "total",
					count(a.id) filter (
						where q.nps_promoter_min is not null
							and a.scale_value >= q.nps_promoter_min
					)::text as "promoters",
					count(a.id) filter (
						where q.nps_passive_min is not null
							and a.scale_value >= q.nps_passive_min
							and a.scale_value < q.nps_promoter_min
					)::text as "passives",
					count(a.id) filter (
						where q.nps_passive_min is not null
							and a.scale_value < q.nps_passive_min
					)::text as "detractors"
				from survey_question q
				-- Left, so a question nobody answered is still reported: a missing
				-- question reads as one that was never asked.
				left join survey_answer a on a.question_id = q.id
					and a.response_id in (select response_id from scoped)
					-- The version people actually answered, not every version the
					-- survey has ever had: a question belongs to a wording, and a
					-- draft nobody was shown has no answers to report.
				where q.content_version_id in (select distinct content_version_id from scoped)
				group by q.content_item_id, q.id, q.position, q.kind, q.prompt, q.required,
					q.scale_min, q.scale_max, q.nps_promoter_min, q.nps_passive_min
				order by q.content_item_id, q.position
			`)
		).rows

		const distributions = (
			await db.execute<{ questionId: string; value: number; responses: string }>(sql`
				select
					a.question_id as "questionId",
					a.scale_value as "value",
					count(*)::text as "responses"
				from survey_answer a
				join survey_response r on r.response_id = a.response_id
				where ${submitted} and a.skipped is false and a.scale_value is not null
				group by a.question_id, a.scale_value
			`)
		).rows

		const prompts = (
			await db.execute<{ contentItemId: string; shown: string; declined: string }>(sql`
				-- An event names the survey by the logical id the bundle gave it,
				-- which is what a device knows it by. The same rule the renderer
				-- uses is applied backwards here rather than written out twice.
				select
					substring(
						e.properties ->> 'logicalId'
						from ${sql.raw(String(CONTENT_LOGICAL_ID_PREFIX.length + 1))}
					)::uuid as "contentItemId",
					count(*) filter (where e.event_name = 'survey_prompt_shown')::text as "shown",
					count(*) filter (where e.event_name = 'survey_declined')::text as "declined"
				from analytics_event e
				where ${occurred}
					and e.event_name in ('survey_prompt_shown', 'survey_declined')
					and (e.properties ->> 'logicalId') ~ ${`^${CONTENT_LOGICAL_ID_PREFIX.replace(".", "\\.")}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`}
				group by 1
			`)
		).rows

		const byQuestion = new Map<string, QuestionRow[]>()
		for (const row of questions) {
			const list = byQuestion.get(row.contentItemId) ?? []
			list.push(row)
			byQuestion.set(row.contentItemId, list)
		}
		const chosen = new Map<string, Map<number, number>>()
		for (const row of distributions) {
			const scale = chosen.get(row.questionId) ?? new Map<number, number>()
			scale.set(Number(row.value), Number(row.responses))
			chosen.set(row.questionId, scale)
		}
		const shownFor = new Map(prompts.map(row => [row.contentItemId, row]))

		let ratingTotal = 0
		let ratingAnswers = 0
		const overall = { promoters: 0, passives: 0, detractors: 0 }

		const surveys = responses
			.map(survey => {
				const asked = byQuestion.get(survey.contentItemId) ?? []
				const shown = shownFor.get(survey.contentItemId)
				const promptsShown = Number(shown?.shown ?? 0)
				const stored = Number(survey.responses)

				let surveyRatingTotal = 0
				let surveyRatingAnswers = 0

				const questionMetrics: SurveyQuestionMetric[] = asked.map(question => {
					const answered = Number(question.answered)
					const total = Number(question.total ?? 0)
					if (question.kind === "rating") {
						surveyRatingTotal += total
						surveyRatingAnswers += answered
						ratingTotal += total
						ratingAnswers += answered
					}
					const nps =
						question.kind === "nps"
							? this.nps(
									Number(question.promoters),
									Number(question.passives),
									Number(question.detractors)
								)
							: null
					if (nps) {
						overall.promoters += nps.promoters
						overall.passives += nps.passives
						overall.detractors += nps.detractors
					}

					return {
						questionId: question.questionId,
						position: question.position,
						kind: question.kind,
						prompt: question.prompt,
						required: question.required,
						answered,
						skipped: Number(question.skipped),
						average: answered === 0 ? null : this.round(total / answered),
						distribution: this.distribution(question, chosen.get(question.questionId)),
						nps,
					}
				})

				return {
					contentItemId: survey.contentItemId,
					title: survey.title,
					promptsShown,
					declined: Number(shown?.declined ?? 0),
					responses: stored,
					completionRatePercent: this.rate(stored, promptsShown),
					averageRating:
						surveyRatingAnswers === 0
							? null
							: this.round(surveyRatingTotal / surveyRatingAnswers),
					consent: {
						granted: Number(survey.granted),
						withdrawn: Number(survey.withdrawn),
					},
					questions: questionMetrics,
				}
			})
			.sort((left, right) => left.title.localeCompare(right.title))

		return {
			from: input.from,
			to: input.to,
			timezone: MANILA,
			totalResponses: surveys.reduce((sum, survey) => sum + survey.responses, 0),
			overallAverageRating:
				ratingAnswers === 0 ? null : this.round(ratingTotal / ratingAnswers),
			overallNps: this.nps(overall.promoters, overall.passives, overall.detractors),
			consent: {
				granted: surveys.reduce((sum, survey) => sum + survey.consent.granted, 0),
				withdrawn: surveys.reduce((sum, survey) => sum + survey.consent.withdrawn, 0),
			},
			// AN-11 imports the store ratings; until it lands, saying so is more
			// honest than a "consolidated" figure that is only the in-app half.
			storeRatingsAvailable: false,
			surveys,
		}
	}

	/**
	 * Every point on the question's scale, including the ones nobody chose.
	 *
	 * A missing bar reads as a value that could not be picked, which is not the
	 * same as one nobody picked.
	 */
	private distribution(
		question: QuestionRow,
		picked: Map<number, number> | undefined
	): ScaleDistributionPoint[] {
		if (question.scaleMin === null || question.scaleMax === null) return []
		const answered = Number(question.answered)
		const points: ScaleDistributionPoint[] = []
		for (let value = question.scaleMin; value <= question.scaleMax; value += 1) {
			const responses = picked?.get(value) ?? 0
			points.push({ value, responses, percent: this.rate(responses, answered) })
		}
		return points
	}

	/** Percent promoters minus percent detractors, null when nobody answered. */
	private nps(promoters: number, passives: number, detractors: number): NpsBreakdown {
		const answered = promoters + passives + detractors
		const promoterPercent = this.rate(promoters, answered)
		const passivePercent = this.rate(passives, answered)
		const detractorPercent = this.rate(detractors, answered)

		return {
			promoters,
			passives,
			detractors,
			promoterPercent,
			passivePercent,
			detractorPercent,
			// Null rather than zero: zero means the promoters and the detractors
			// cancelled out, which is not what silence means.
			score: answered === 0 ? null : this.round(promoterPercent - detractorPercent),
		}
	}

	/** Zero rather than a division by zero: an empty pool has no rate. */
	private rate(part: number, whole: number): number {
		if (whole === 0) return 0
		return Math.min(100, this.round((part / whole) * 100))
	}

	private round(value: number): number {
		return Math.round(value * 100) / 100
	}
}
