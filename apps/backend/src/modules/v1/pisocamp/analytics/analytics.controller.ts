import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"
import { Logger } from "nestjs-pino"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { AnalyticsService } from "./analytics.service"
import { AdoptionService } from "./adoption.service"
import { EngagementService } from "./engagement.service"
import { GamificationService } from "./gamification.service"
import { RetentionService } from "./retention.service"

@Controller()
export class AnalyticsController {
	constructor(
		private readonly analyticsService: AnalyticsService,
		private readonly engagementService: EngagementService,
		private readonly adoptionService: AdoptionService,
		private readonly retentionService: RetentionService,
		private readonly gamificationService: GamificationService,
		private readonly logger: Logger
	) {}

	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.pisocamp.events.ingest)
	ingest() {
		return implement(v1.pisocamp.events.ingest).handler(({ input }) =>
			this.runSafely("ingest", () => this.analyticsService.ingest(input))
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.analytics.adoption)
	adoption() {
		return implement(v1.pisocamp.analytics.adoption).handler(({ input }) =>
			this.runSafely("adoption", () => this.adoptionService.summary(input))
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.analytics.engagement)
	engagement() {
		return implement(v1.pisocamp.analytics.engagement).handler(({ input }) =>
			this.runSafely("engagement", () => this.engagementService.summary(input))
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.analytics.retention)
	retention() {
		return implement(v1.pisocamp.analytics.retention).handler(({ input }) =>
			this.runSafely("retention", () => this.retentionService.summary(input))
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.analytics.gamification)
	gamification() {
		return implement(v1.pisocamp.analytics.gamification).handler(({ input }) =>
			this.runSafely("gamification", () => this.gamificationService.summary(input))
		)
	}

	@RequirePermissions("reports.dashboards.view")
	@Implement(v1.pisocamp.analytics.moduleEntryToday)
	moduleEntryToday() {
		return implement(v1.pisocamp.analytics.moduleEntryToday).handler(() =>
			this.runSafely("moduleEntryToday", () => this.analyticsService.moduleEntryToday())
		)
	}

	private async runSafely<T>(
		operation: "ingest" | "moduleEntryToday" | "engagement" | "adoption" | "retention" | "gamification",
		work: () => Promise<T>
	) {
		try {
			return await work()
		} catch (error) {
			if (error instanceof ORPCError) throw error
			this.logger.error({ operation }, "Unexpected analytics operation failure")
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Analytics operation failed" })
		}
	}
}
