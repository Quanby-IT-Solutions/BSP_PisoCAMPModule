import { SetMetadata } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { Logger } from "nestjs-pino"

import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { STRICT_THROTTLE_KEY } from "@/shared/decorators/strict-throttle.decorator"

import { AnalyticsController } from "./analytics.controller"
import { AnalyticsService } from "./analytics.service"
import { AdoptionService } from "./adoption.service"
import { GamificationService } from "./gamification.service"
import { SurveyMetricsService } from "./survey-metrics.service"
import { TechnicalMetricsService } from "./technical-metrics.service"
import { DemographicsService } from "./demographics.service"
import { RetentionService } from "./retention.service"
import { EngagementService } from "./engagement.service"

const ingestInput = {
	events: [
		{
			schemaVersion: 1 as const,
			eventId: "6bdf8864-f630-46e1-a17f-52354afccf57",
			eventName: "module_entry" as const,
			occurredAt: "2026-08-30T15:59:59.999Z",
			subjectPseudoId: "AbCdEfGhIjKlMnOpQrSt_-",
			sessionId: "8c479891-9c42-4550-b5a7-2ab6059c8a91",
			accountType: "guest" as const,
			screen: "pisocamp_home" as const,
			feature: "module" as const,
			appVersion: "1.0.0",
			osName: "android" as const,
			osVersion: "15",
			deviceCategory: "phone" as const,
			networkState: "online" as const,
			status: "completed" as const,
			properties: { entryPoint: "navigation" as const },
		},
	],
}

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
	implement: jest.fn((contract: string) => ({
		handler: (handler: (args: { input: unknown }) => unknown) =>
			handler({ input: contract === "analyticsIngest" ? ingestInput : undefined }),
	})),
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		pisocamp: {
			events: { ingest: "analyticsIngest" },
			analytics: { moduleEntryToday: "moduleEntryToday" },
		},
	},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => SetMetadata("PUBLIC", true),
	Session: () => () => undefined,
}))

describe("AnalyticsController", () => {
	let ingested: unknown
	let ingestFailure: unknown
	const logCalls: unknown[][] = []
	const acknowledged = { ackedEventIds: [ingestInput.events[0]!.eventId] }
	const summary = {
		date: "2026-08-31",
		timezone: "Asia/Manila" as const,
		moduleEntryCount: 17,
	}
	const service = {
		ingest: async (input: unknown) => {
			if (ingestFailure) throw ingestFailure
			ingested = input
			return acknowledged
		},
		moduleEntryToday: async () => summary,
	}
	let controller: AnalyticsController

	beforeEach(async () => {
		ingested = undefined
		ingestFailure = undefined
		logCalls.length = 0
		const module = await Test.createTestingModule({
			controllers: [AnalyticsController],
			providers: [
				{ provide: AnalyticsService, useValue: service },
				// AN-2's dashboard is its own service; this suite is about the
				// controller's decorators and error translation.
				{ provide: EngagementService, useValue: { summary: async () => null } },
				{ provide: AdoptionService, useValue: { summary: async () => null } },
				{ provide: RetentionService, useValue: { summary: async () => null } },
				{ provide: GamificationService, useValue: { summary: async () => null } },
				{ provide: SurveyMetricsService, useValue: { summary: async () => null } },
				{ provide: TechnicalMetricsService, useValue: { summary: async () => null } },
				{ provide: DemographicsService, useValue: { summary: async () => null } },
				{
					provide: Logger,
					useValue: { error: (...args: unknown[]) => logCalls.push(args) },
				},
			],
		}).compile()
		controller = module.get(AnalyticsController)
	})

	it("keeps only anonymous ingestion strict-throttled and protects the summary permission", () => {
		expect(Reflect.getMetadata("PUBLIC", AnalyticsController.prototype.ingest)).toBe(true)
		expect(Reflect.getMetadata(STRICT_THROTTLE_KEY, AnalyticsController.prototype.ingest)).toBe(
			true
		)
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AnalyticsController.prototype.moduleEntryToday)
		).toEqual(["reports.dashboards.view"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AnalyticsController.prototype.engagement)
		).toEqual(["reports.dashboards.view"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AnalyticsController.prototype.adoption)
		).toEqual(["reports.dashboards.view"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AnalyticsController.prototype.retention)
		).toEqual(["reports.dashboards.view"])
		expect(
			Reflect.getMetadata("PUBLIC", AnalyticsController.prototype.moduleEntryToday)
		).toBeUndefined()
		expect(
			Reflect.getMetadata(STRICT_THROTTLE_KEY, AnalyticsController.prototype.moduleEntryToday)
		).toBeUndefined()
	})

	it("delegates the validated ingestion input and returns only the acknowledgement", async () => {
		await expect(controller.ingest()).resolves.toEqual(acknowledged)
		expect(ingested).toEqual(ingestInput)
	})

	it("returns the exact protected aggregate without adding identity or request data", async () => {
		await expect(controller.moduleEntryToday()).resolves.toEqual(summary)
	})

	it("translates an unknown failure without logging its raw message or request data", async () => {
		const rawSentinel = "raw-driver-password-event-body-sentinel"
		ingestFailure = new Error(rawSentinel)

		await expect(controller.ingest()).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Analytics operation failed",
		})
		expect(logCalls).toEqual([[{ operation: "ingest" }, "Unexpected analytics operation failure"]])
		expect(JSON.stringify(logCalls)).not.toContain(rawSentinel)
		expect(JSON.stringify(logCalls)).not.toContain(ingestInput.events[0]!.eventId)
	})
})
