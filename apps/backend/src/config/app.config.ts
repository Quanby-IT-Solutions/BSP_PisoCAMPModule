import { Logger, PayloadTooLargeException, type INestApplication } from "@nestjs/common"
import * as express from "express"
import type { NextFunction, Request, Response } from "express"

import { parseOriginList } from "@repo/auth"

import { env } from "@/config/env.config"

const logger = new Logger("AppConfig")

/**
 * Largest request body unrelated routes will parse (AB-4 / F-14).
 *
 * Both parsers were unbounded, so any endpoint would buffer an arbitrarily
 * large body into memory before a single line of application code ran — a
 * memory-exhaustion path on every mutation route.
 *
 * The anonymous analytics ingestion route has a closed, bounded catalog whose
 * structurally maximal request is about 132 KiB, so that exact POST route gets
 * a separate 512 KiB ceiling without relaxing any unrelated route.
 *
 * Nginx is set to 1m rather than 512kb on purpose: the proxy limit counts the
 * whole request, so matching the two exactly would let header size decide
 * whether a legitimate body is rejected, and by the wrong layer. The gap means
 * oversized junk dies at the edge while borderline requests get a coherent 413
 * from the app.
 */
export const MAX_REQUEST_BODY_SIZE = "100kb"
export const ANALYTICS_REQUEST_BODY_SIZE = "512kb"

const ANALYTICS_INGESTION_PATH = "/api/v1/pisocamp/events"

function isAnalyticsIngestion(request: Request): boolean {
	return request.method === "POST" && request.path === ANALYTICS_INGESTION_PATH
}

function isPayloadTooLarge(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false
	const candidate = error as { status?: unknown; statusCode?: unknown; type?: unknown }
	return (
		candidate.status === 413 ||
		candidate.statusCode === 413 ||
		candidate.type === "entity.too.large"
	)
}

function runBodyParser(
	parser: express.RequestHandler,
	request: Request,
	response: Response,
	next: NextFunction,
	limitMessage: string
): void {
	parser(request, response, error => {
		if (isPayloadTooLarge(error)) {
			next(new PayloadTooLargeException(limitMessage))
			return
		}
		next(error)
	})
}

/**
 * Configure body parser middleware for non-auth routes
 * Note: bodyParser is disabled in bootstrap.ts to allow Better Auth to handle its own body parsing.
 * We need to manually add JSON parsing for all other routes.
 */
function configureBodyParser(app: INestApplication): void {
	const httpAdapter = app.getHttpAdapter()
	const parsers = {
		default: {
			json: express.json({ limit: MAX_REQUEST_BODY_SIZE }),
			urlencoded: express.urlencoded({ extended: true, limit: MAX_REQUEST_BODY_SIZE }),
			message: "Request body exceeds the 100 KiB limit",
		},
		analytics: {
			json: express.json({ limit: ANALYTICS_REQUEST_BODY_SIZE }),
			urlencoded: express.urlencoded({ extended: true, limit: ANALYTICS_REQUEST_BODY_SIZE }),
			message: "Request body exceeds the 512 KiB limit",
		},
	}
	httpAdapter.use((request: Request, response: Response, next: NextFunction) => {
		const selected = isAnalyticsIngestion(request) ? parsers.analytics : parsers.default
		runBodyParser(selected.json, request, response, next, selected.message)
	})
	httpAdapter.use((request: Request, response: Response, next: NextFunction) => {
		const selected = isAnalyticsIngestion(request) ? parsers.analytics : parsers.default
		runBodyParser(selected.urlencoded, request, response, next, selected.message)
	})
	logger.log(
		`Body parser middleware configured (default: ${MAX_REQUEST_BODY_SIZE}; analytics ingestion: ${ANALYTICS_REQUEST_BODY_SIZE})`
	)
}

/**
 * Configure CORS for the application
 *
 * Must run BEFORE Better Auth middleware is registered so that auth routes
 * (/api/v1/auth/*) receive CORS headers and OPTIONS preflight is handled.
 * Express runs middleware in registration order; the auth middleware
 * short-circuits matching requests, so CORS must come first.
 */
export function configureCors(app: INestApplication): void {
	// AC-5 / F-32: the same parser @repo/auth uses for its trusted-origin list,
	// so the two allowlists cannot drift. This one trimmed but did not drop
	// empties, so a trailing comma produced an empty origin.
	const origins = parseOriginList(env.CORS_ORIGINS)
	app.enableCors({
		origin: origins,
		credentials: true,
		exposedHeaders: ["Retry-After", "X-Retry-After", "X-Request-Id"],
	})
	logger.log(`CORS enabled for origins: ${origins.join(", ")}`)
}

/**
 * Enable graceful shutdown handlers for SIGTERM and SIGINT signals
 */
function enableGracefulShutdown(app: INestApplication): void {
	const shutdown = async (signal: string): Promise<void> => {
		logger.log(`Received ${signal}, starting graceful shutdown...`)
		try {
			await app.close()
			logger.log("Application closed successfully")
			process.exit(0)
		} catch (error) {
			logger.error("Error during graceful shutdown", error)
			process.exit(1)
		}
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"))
	process.on("SIGINT", () => void shutdown("SIGINT"))
	logger.log("Graceful shutdown handlers registered")
}

/**
 * Configure all application-level settings
 * Note: Global pipes/interceptors/filters are registered via APP_* providers in app.module.ts
 */
export function configureApp(app: INestApplication): void {
	configureBodyParser(app)
	enableGracefulShutdown(app)
}
