import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import {
	analyticsEvents,
	auditLog,
	consentRecords,
	surveyAnswers,
	surveyQuestions,
	surveyResponses,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"
import { AcquisitionService } from "./acquisition.service"
import { SurveyMetricsService } from "./survey-metrics.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const ADMIN_ID = "an11-admin"
const APPROVER_ID = "an11-approver"
const DEVICE = "AnElevenDeviceId000001"
const NOTICE_ID = "8e2b1a7e-9f4c-4a2e-9d54-0a3b7a2c9e41"
const NOTICE_VERSION = "an11-notice-1"

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

/** Manila is UTC+8, so 08:00 UTC is 16:00 local on the same day. */
function manila(day: number, hour = 10) {
	return new Date(Date.UTC(2026, 8, day, hour - 8))
}

function correlation(itemId: string, expectedVersionNo: number, comments?: string) {
	return {
		itemId,
		requestId: randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	} as never
}

/**
 * AN-11. A store counts downloads and the module counts devices that opened
 * it. They are different figures, so the report says which one it is showing
 * and never adds them together.
 */
describe("AN-11 install volume and store ratings", () => {
	let service: AcquisitionService
	let surveys: SurveyMetricsService
	let itemId: string
	let versionId: string
	let ratingQuestionId: string

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table store_metric_import, survey_answer, survey_response, analytics_event,
				content_bundle_rebuild_request, version_asset, asset, asset_object,
				survey_question, survey_detail, trivia_question_detail, related_link,
				content_version, content_item, consent_record, privacy_notice,
				audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${ADMIN_ID}, 'AN11 Admin', 'an11-admin@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'AN11 Approver', 'an11-approver@example.test', true, now(), now())
		`)
		await db.execute(sql`
			insert into privacy_notice (id, version, title, body, source_url, content_sha256, effective_at)
			values (${NOTICE_ID}, ${NOTICE_VERSION}, 'AN11 notice', 'Body copy for the AN-11 fixture.',
			        'https://www.bsp.gov.ph/privacy', repeat('d', 64), now())
		`)

		const audit = new AuditService()
		const content = new ContentService(audit)
		const workflow = new ContentWorkflowService(audit)
		const created = await content.create(
			{
				requestId: randomUUID(),
				content: {
					contentType: "survey",
					title: "How did we do?",
					summary: "A short evaluation shown after a topic.",
					body: "Answering is optional.",
					purpose: "satisfaction",
					subjectContentItemId: null,
					questions: [
						{
							kind: "rating",
							prompt: "How clear was this topic?",
							required: true,
							lowLabel: "Not clear at all",
							highLabel: "Very clear",
						},
					],
				},
				relatedLinks: [],
			},
			ADMIN_ID
		)
		await workflow.transition("submit", correlation(created.id, 1, "Ready"), ADMIN_ID)
		await workflow.transition("approve", correlation(created.id, 2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(created.id, 3), APPROVER_ID)

		itemId = created.id
		versionId = (await content.get(created.id)).currentVersion.id
		const rows = await db
			.select()
			.from(surveyQuestions)
			.where(eq(surveyQuestions.contentVersionId, versionId))
		ratingQuestionId = rows[0]!.id
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table store_metric_import, survey_answer, survey_response, consent_record,
				analytics_event, audit_log
			restart identity cascade
		`)
		service = new AcquisitionService(new AuditService())
		surveys = new SurveyMetricsService()
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function firstOpen(when: Date, subjectPseudoId = DEVICE) {
		await db.insert(analyticsEvents).values({
			eventId: randomUUID(),
			schemaVersion: 1,
			eventName: "first_open",
			occurredAt: when,
			subjectPseudoId,
			sessionId: randomUUID(),
			accountType: "guest",
			appVersion: "1.0.0",
			osName: "android",
			osVersion: "15",
			deviceCategory: "phone",
			networkState: "unknown",
			screen: "pisocamp_home",
			feature: "module",
			status: "completed",
			properties: {} as never,
		})
	}

	async function inAppRating(value: number, when: Date) {
		const consentId = randomUUID()
		await db.insert(consentRecords).values({
			id: consentId,
			devicePseudoId: DEVICE,
			purpose: "survey",
			noticeId: NOTICE_ID,
			noticeVersion: NOTICE_VERSION,
			status: "granted",
			respondedAt: when,
		})
		const responseId = randomUUID()
		await db.insert(surveyResponses).values({
			responseId,
			contentItemId: itemId,
			contentVersionId: versionId,
			consentRecordId: consentId,
			devicePseudoId: DEVICE,
			submittedAt: when,
		})
		await db.insert(surveyAnswers).values({
			responseId,
			questionId: ratingQuestionId,
			scaleValue: value,
		})
	}

	const googlePlay = {
		source: "google_play" as const,
		periodStart: "2026-09-01",
		periodEnd: "2026-09-07",
		installs: 1200,
		uninstalls: 40,
		ratingAverage: 4.4,
		ratingCount: 100,
	}

	describe("AC1 — install volume, labelled and not double-counted", () => {
		it("reports both figures and names the one in the headline", async () => {
			await firstOpen(manila(2), "AnElevenDeviceId000001")
			await firstOpen(manila(3), "AnElevenDeviceId000002")
			await service.importStoreMetrics({ rows: [googlePlay] }, ADMIN_ID)

			const summary = await service.summary(RANGE)

			expect(summary.installVolume).toMatchObject({
				firstOpenDevices: 2,
				storeInstalls: 1200,
				storeUninstalls: 40,
				headlineSource: "store",
				headlineInstalls: 1200,
				sourceLabel: "Store reports (Google Play)",
			})
			// Adding the two would count every install that was opened twice.
			expect(summary.installVolume.headlineInstalls).not.toBe(1202)
		})

		it("counts a device once however often it reports a first open", async () => {
			await firstOpen(manila(2))
			await firstOpen(manila(3))

			const summary = await service.summary(RANGE)

			// A reinstall on the same device is not a second device.
			expect(summary.installVolume.firstOpenDevices).toBe(1)
		})

		it("falls back to the module's own count when no store was imported", async () => {
			await firstOpen(manila(2))

			const summary = await service.summary(RANGE)

			expect(summary.installVolume).toMatchObject({
				headlineSource: "in_app",
				headlineInstalls: 1,
				sourceLabel: "First opens reported by the module",
			})
			expect(summary.storeDataAvailable).toBe(false)
		})

		it("says there is no install data rather than reporting zero installs", async () => {
			const summary = await service.summary(RANGE)

			expect(summary.installVolume).toMatchObject({
				headlineSource: null,
				headlineInstalls: null,
				sourceLabel: "No install data for this range",
			})
		})

		it("replaces a store period on re-import instead of adding to it", async () => {
			await service.importStoreMetrics({ rows: [googlePlay] }, ADMIN_ID)
			const second = await service.importStoreMetrics({ rows: [googlePlay] }, ADMIN_ID)

			const summary = await service.summary(RANGE)

			expect(second).toEqual({ imported: 1, replaced: 1 })
			expect(summary.installVolume.storeInstalls).toBe(1200)
		})

		it("ignores a store period that only half overlaps the range", async () => {
			await service.importStoreMetrics(
				{
					rows: [
						{ ...googlePlay, periodStart: "2026-08-28", periodEnd: "2026-09-03" },
					],
				},
				ADMIN_ID
			)

			const summary = await service.summary(RANGE)

			expect(summary.installVolume.storeInstalls).toBe(0)
			expect(summary.storeDataAvailable).toBe(false)
		})

		it("records who imported the figures", async () => {
			await service.importStoreMetrics({ rows: [googlePlay] }, ADMIN_ID)

			const rows = await db.select().from(auditLog)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				domain: "pisocamp",
				action: "store_metrics.import",
				actorId: ADMIN_ID,
			})
		})
	})

	describe("AC2 — store ratings beside the in-app ones", () => {
		it("shows both averages and weights the combined one by count", async () => {
			await service.importStoreMetrics({ rows: [googlePlay] }, ADMIN_ID)
			await inAppRating(5, manila(2))
			await inAppRating(3, manila(3))

			const summary = await service.summary(RANGE)

			expect(summary.ratings).toMatchObject({
				inAppAverage: 4,
				inAppResponses: 2,
				storeAverage: 4.4,
				storeRatings: 100,
				combinedRatings: 102,
			})
			// (4.4 × 100 + 8) ÷ 102 — an average of the two averages would let
			// two in-app answers weigh as much as a hundred store ratings.
			expect(summary.ratings.combinedAverage).toBeCloseTo(4.39, 2)
		})

		it("weights two stores by their own rating counts", async () => {
			await service.importStoreMetrics(
				{
					rows: [
						googlePlay,
						{
							source: "app_store",
							periodStart: "2026-09-01",
							periodEnd: "2026-09-07",
							installs: 300,
							uninstalls: 5,
							ratingAverage: 3.4,
							ratingCount: 100,
						},
					],
				},
				ADMIN_ID
			)

			const summary = await service.summary(RANGE)

			expect(summary.stores.map(store => store.source)).toEqual([
				"app_store",
				"google_play",
			])
			expect(summary.ratings.storeAverage).toBe(3.9)
			expect(summary.installVolume.storeInstalls).toBe(1500)
			expect(summary.installVolume.sourceLabel).toBe(
				"Store reports (App Store, Google Play)"
			)
		})

		it("says nobody rated rather than reporting a zero", async () => {
			const summary = await service.summary(RANGE)

			expect(summary.ratings).toMatchObject({
				inAppAverage: null,
				storeAverage: null,
				combinedAverage: null,
				combinedRatings: 0,
			})
		})

		it("keeps a store period with installs but no rating out of the average", async () => {
			await service.importStoreMetrics(
				{
					rows: [
						{ ...googlePlay, ratingAverage: null, ratingCount: null },
					],
				},
				ADMIN_ID
			)
			await inAppRating(4, manila(2))

			const summary = await service.summary(RANGE)

			expect(summary.installVolume.storeInstalls).toBe(1200)
			expect(summary.ratings).toMatchObject({
				storeAverage: null,
				storeRatings: 0,
				combinedAverage: 4,
				combinedRatings: 1,
			})
		})
	})

	describe("AN-6's seam, now that AN-11 exists", () => {
		it("keeps saying the ratings are in-app only until a store is imported", async () => {
			await inAppRating(4, manila(2))

			await expect(surveys.summary(RANGE)).resolves.toMatchObject({
				storeRatingsAvailable: false,
			})
		})

		it("says store ratings are available once one has been imported", async () => {
			await inAppRating(4, manila(2))
			await service.importStoreMetrics({ rows: [googlePlay] }, ADMIN_ID)

			// The survey report's disclaimer was a promise about AN-11; now that
			// AN-11 is here, it has to stop making it.
			await expect(surveys.summary(RANGE)).resolves.toMatchObject({
				storeRatingsAvailable: true,
			})
		})
	})
})
