import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"

import { env } from "@/config/env.config"

import type { BundleBuilder } from "./bundle-builder"
import { sanitizeBundleErrorCode } from "./bundle-repository"

@Injectable()
export class BundleWorker {
	private readonly logger = new Logger(BundleWorker.name)
	private running: Promise<void> | null = null
	private attemptCount = 0

	constructor(
		private readonly builder: BundleBuilder,
		private readonly enabled: boolean
	) {}

	@Interval("pisocamp-bundle-worker", env.PISOCAMP_BUNDLE_POLL_INTERVAL_MS)
	runInterval(): Promise<void> {
		return this.runOnce("interval")
	}

	runOnce(reason: "interval" | "bootstrap" | "manual"): Promise<void> {
		if (!this.enabled) return Promise.resolve()
		if (this.running) return this.running

		const startedAt = Date.now()
		const attempt = ++this.attemptCount
		this.running = this.builder
			.buildNextBundle(reason)
			.then(result => {
				this.logger.log({
					operation: "pisocamp_bundle_build",
					phase: reason,
					outcome: result.outcome,
					attempt,
					count: 1,
					version: result.bundleVersion,
					duration: Date.now() - startedAt,
				})
			})
			.catch(error => {
				this.logger.error({
					operation: "pisocamp_bundle_build",
					phase: reason,
					outcome: "failed",
					attempt,
					count: 1,
					errorCode: sanitizeBundleErrorCode(error),
					duration: Date.now() - startedAt,
				})
			})
			.finally(() => {
				this.running = null
			})
		return this.running
	}
}
