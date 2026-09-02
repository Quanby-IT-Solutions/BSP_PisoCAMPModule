import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"

import { env } from "@/config/env.config"

import type { ContentWorkflowService } from "./content-workflow.service"

/**
 * CM-6 scheduled-publication worker.
 *
 * Polls rather than sleeping to a deadline: an instance can restart at any
 * moment, and a timer scheduled in one process is not a promise the module can
 * keep. Every run re-reads live state, so a restart, a second instance, or a
 * re-run costs nothing — `publishDueScheduled` publishes only items that are
 * still approved and still due, and publishing clears the schedule in the same
 * transaction.
 */
@Injectable()
export class ContentScheduleWorker {
	private readonly logger = new Logger(ContentScheduleWorker.name)
	private running: Promise<void> | null = null
	private attemptCount = 0

	constructor(
		private readonly workflow: ContentWorkflowService,
		private readonly enabled: boolean
	) {}

	@Interval("pisocamp-content-schedule-worker", env.PISOCAMP_SCHEDULE_POLL_INTERVAL_MS)
	runInterval(): Promise<void> {
		return this.runOnce("interval")
	}

	runOnce(reason: "interval" | "manual"): Promise<void> {
		if (!this.enabled) return Promise.resolve()
		if (this.running) return this.running

		const startedAt = Date.now()
		const attempt = ++this.attemptCount
		this.running = this.workflow
			.publishDueScheduled()
			.then(result => {
				if (result.published.length === 0 && result.failed.length === 0) return
				this.logger.log({
					operation: "pisocamp_scheduled_publish",
					phase: reason,
					outcome: result.failed.length ? "partial" : "published",
					attempt,
					count: result.published.length,
					skipped: result.failed.length,
					duration: Date.now() - startedAt,
				})
			})
			.catch(() => {
				// Metadata only: a scheduling failure must never put content or
				// actor detail into the log.
				this.logger.error({
					operation: "pisocamp_scheduled_publish",
					phase: reason,
					outcome: "failed",
					attempt,
					count: 0,
					duration: Date.now() - startedAt,
				})
			})
			.finally(() => {
				this.running = null
			})
		return this.running
	}
}
