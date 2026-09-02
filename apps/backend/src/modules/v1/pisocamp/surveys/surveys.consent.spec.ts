import { Body, Controller, Global, INestApplication, Module, Post, Req } from "@nestjs/common"
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import type { Server } from "node:http"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import type { Request as ExpressRequest } from "express"
import { Logger, LoggerModule } from "nestjs-pino"
import request from "supertest"

import { consentRecords, surveyResponses } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { HttpExceptionFilter } from "@/common/filters/http-exception.filter"
import { SentryExceptionFilter } from "@/common/filters/sentry-exception.filter"
import { RbacModule } from "@/common/rbac/rbac.module"
import { REDIS_CLIENT } from "@/common/redis/redis.provider"
import { buildPinoHttpOptions } from "@/config/pino-logger.config"
import { PisoCampConsentSubjectService } from "@/modules/v1/pisocamp/pisocamp-consent-subject.service"
import {
	pisoCampConsentDatabaseProvider,
	PisoCampConsentService,
	pisoCampConsentTransactionProvider,
} from "@/modules/v1/pisocamp/pisocamp-consent.service"
import {
	REQUIRED_CONSENT_KEY,
	RequireConsent,
} from "@/shared/decorators/require-consent.decorator"
import { ConsentGuard } from "@/shared/guards/consent.guard"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { ContentWorkflowService } from "../content/content-workflow.service"
import { ContentService } from "../content/content.service"
import { SurveyResponseService } from "./survey-response.service"
import { SurveysController } from "./surveys.controller"

jest.mock("@orpc/nest", () => ({ Implement: () => () => undefined }))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
		}
	},
	implement: jest.fn(() => ({ handler: (handler: () => unknown) => handler() })),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			surveys: { ingest: "surveysIngest" },
			admin: {
				surveyTriggers: {
					list: "listTriggers",
					upsert: "upsertTrigger",
					remove: "removeTrigger",
				},
			},
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => () => undefined,
	Session: () => () => undefined,
}))
jest.mock("better-auth/node", () => ({ fromNodeHeaders: () => ({}) }))
jest.mock("@repo/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }))
jest.mock("@repo/contracts", () => ({ ADMIN_ROLE: "Admin", PERMISSION_NAMES: [] }))
jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }))

const EDITOR_ID = "ev2-consent-editor"
const APPROVER_ID = "ev2-consent-approver"
const GRANTED_DEVICE = "Ev2GrantedDevicePseu01"
const DECLINED_DEVICE = "Ev2DeclinedDeviceP0012"
const SILENT_DEVICE = "Ev2SilentDevicePseu012"
const NOTICE_ID = "1e2d3c4b-5a69-4f78-8b9c-0d1e2f3a4b5c"
const NOTICE_VERSION = "ev2-consent-notice-1"

@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: null }], exports: [REDIS_CLIENT] })
class TestRedisModule {}

/** The route under test, carrying the very decorator the real controller does. */
@Controller("ev2-surveys")
class Ev2ConsentController {
	constructor(
		private readonly responses: SurveyResponseService,
		private readonly subjects: PisoCampConsentSubjectService
	) {}

	@Post("responses")
	@RequireConsent("survey")
	async ingest(@Req() request_: ExpressRequest, @Body() body: { responses: unknown[] }) {
		return this.responses.ingest(await this.subjects.resolve(request_ as never), body as never)
	}
}

/**
 * EV-2 AC2. Consent is not a thing the handler remembers to check: it is
 * declared on the route, and the guard refuses the request before any handler
 * runs. Both branches are proven here, and the real controller is asserted to
 * carry the same declaration.
 */
describe("EV-2 survey response consent gate", () => {
	let app: INestApplication
	let agent: ReturnType<typeof request>
	let surveyItemId: string
	let surveyVersionId: string
	let questionId: string
	let grantedConsentId: string

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		const moduleRef = await Test.createTestingModule({
			imports: [
				TestRedisModule,
				RbacModule,
				LoggerModule.forRoot({
					pinoHttp: [
						{ ...buildPinoHttpOptions({ autoLogging: false }), transport: undefined },
						{ write: () => {} },
					],
				}),
			],
			controllers: [Ev2ConsentController],
			providers: [
				SurveyResponseService,
				PisoCampConsentSubjectService,
				PisoCampConsentService,
				pisoCampConsentDatabaseProvider,
				pisoCampConsentTransactionProvider,
				AuditService,
				{ provide: APP_FILTER, useClass: SentryExceptionFilter },
				{ provide: APP_FILTER, useClass: HttpExceptionFilter },
				{ provide: APP_GUARD, useClass: ConsentGuard },
			],
		}).compile()
		app = moduleRef.createNestApplication()
		app.useLogger(app.get(Logger))
		await app.init()
		agent = request(app.getHttpServer() as Server)

		await db.execute(sql`
			truncate table survey_answer, survey_response, content_bundle_rebuild_request,
				version_asset, asset, asset_object, survey_question, survey_detail,
				trivia_question_detail, related_link, content_version, content_item,
				consent_record, privacy_notice, piso_camp_device_account_link,
				module_configuration, audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'EV2 Editor', 'ev2-consent-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'EV2 Approver', 'ev2-consent-approver@example.test', true, now(), now())
		`)
		await db.execute(sql`
			insert into privacy_notice (id, version, title, body, source_url, content_sha256, effective_at)
			values (${NOTICE_ID}, ${NOTICE_VERSION}, 'EV2 notice', 'Body copy for the EV-2 consent fixture.',
			        'https://www.bsp.gov.ph/privacy', repeat('b', 64), now())
		`)
		await db.execute(sql`
			insert into module_configuration (key, value, updated_by)
			values ('active_privacy_notice_version', ${JSON.stringify(NOTICE_VERSION)}::jsonb, ${EDITOR_ID})
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
			EDITOR_ID
		)
		const correlation = (expectedVersionNo: number, comments?: string) =>
			({
				itemId: created.id,
				requestId: randomUUID(),
				expectedVersionNo,
				...(comments === undefined ? {} : { comments }),
			}) as never
		await workflow.transition("submit", correlation(1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(3), APPROVER_ID)

		surveyItemId = created.id
		surveyVersionId = (await content.get(created.id)).currentVersion.id
		const [question] = await db.execute<{ id: string }>(sql`
			select id from survey_question where content_version_id = ${surveyVersionId}
		`).then(result => result.rows)
		questionId = question!.id

		grantedConsentId = randomUUID()
		await db.insert(consentRecords).values([
			{
				id: grantedConsentId,
				devicePseudoId: GRANTED_DEVICE,
				purpose: "survey",
				noticeId: NOTICE_ID,
				noticeVersion: NOTICE_VERSION,
				status: "granted",
				respondedAt: new Date("2026-09-02T03:00:00.000Z"),
			},
			{
				id: randomUUID(),
				devicePseudoId: DECLINED_DEVICE,
				purpose: "survey",
				noticeId: NOTICE_ID,
				noticeVersion: NOTICE_VERSION,
				status: "declined",
				respondedAt: new Date("2026-09-02T03:00:00.000Z"),
			},
		])
	})

	beforeEach(async () => {
		await db.execute(sql`truncate table survey_answer, survey_response restart identity cascade`)
	})

	afterAll(async () => {
		if (app) await app.close()
		await db.$client.end()
	})

	function body(responseId: string, consentRecordId = grantedConsentId) {
		return {
			responses: [
				{
					responseId,
					contentItemId: surveyItemId,
					contentVersionId: surveyVersionId,
					consentRecordId,
					submittedAt: "2026-09-02T04:05:06.000Z",
					answers: [{ kind: "scale", questionId, value: 5 }],
				},
			],
		}
	}

	it("declares the survey consent purpose on the real route", () => {
		expect(
			new Reflector().get(REQUIRED_CONSENT_KEY, SurveysController.prototype.ingest)
		).toBe("survey")
	})

	it("accepts a submission from a device that granted survey consent", async () => {
		const responseId = "2b3c4d5e-6f70-4a81-8b92-a3b4c5d6e7f8"

		await agent
			.post("/ev2-surveys/responses")
			.set("x-device-pseudo-id", GRANTED_DEVICE)
			.send(body(responseId))
			.expect(201)

		expect(await db.select().from(surveyResponses)).toHaveLength(1)
	})

	it("refuses a device that declined, and collects nothing", async () => {
		const response = await agent
			.post("/ev2-surveys/responses")
			.set("x-device-pseudo-id", DECLINED_DEVICE)
			.send(body("3c4d5e6f-7081-4b92-8ca3-b4c5d6e7f8a9", grantedConsentId))
			.expect(412)

		// The filter nests the guard's extra fields under error.details, and the
		// state is the part that tells a client whether to ask again.
		expect(
			(response.body as { error?: { details?: { state?: string } } }).error?.details?.state
		).toBe("declined")
		expect(await db.select().from(surveyResponses)).toHaveLength(0)
	})

	it("refuses a device that was never asked", async () => {
		const response = await agent
			.post("/ev2-surveys/responses")
			.set("x-device-pseudo-id", SILENT_DEVICE)
			.send(body("4d5e6f70-8192-4ca3-8db4-c5d6e7f8a9b0"))
			.expect(412)

		expect(
			(response.body as { error?: { details?: { state?: string } } }).error?.details?.state
		).toBe("none")
		expect(await db.select().from(surveyResponses)).toHaveLength(0)
	})

	it("refuses a request with no device identity at all", async () => {
		await agent
			.post("/ev2-surveys/responses")
			.send(body("5e6f7081-92a3-4db4-8ec5-d6e7f8a9b0c1"))
			.expect(400)

		expect(await db.select().from(surveyResponses)).toHaveLength(0)
	})
})
