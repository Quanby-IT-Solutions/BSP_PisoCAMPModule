import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { config as loadEnv } from "dotenv"

/**
 * Environment for the backend test suite.
 *
 * `env.config.ts` validates at module load, so any spec that transitively
 * imports it — which is most of them, via the database client — fails to even
 * load without a valid environment. Setting it here once beats each spec
 * re-deriving its own, and keeps specs honest: they exercise the real
 * validated `env`, not a bypass.
 *
 * `.env` is loaded when present so database-backed tests reach the same
 * Postgres the app uses. Other defaults only fill missing values; the auth
 * secret is always test-only so a deploy secret cannot affect test behavior.
 */
loadEnv({ path: resolve(__dirname, ".env"), quiet: true })

const TEST_BETTER_AUTH_SECRET = "j8Kq2ZfP5xR7nT1wV4yB6cE9hL0mS3uA"
const fallbacks: Record<string, string> = {
	NODE_ENV: "test",
	CORS_ORIGINS: "http://localhost:3001",
	BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3001",
	DATABASE_URL: "postgres://postgres:password@localhost:5432/turbo-template",
}

for (const [key, value] of Object.entries(fallbacks)) {
	process.env[key] ??= value
}

process.env.BETTER_AUTH_SECRET = TEST_BETTER_AUTH_SECRET

// Guard against a stale build being picked up instead of source.
if (!existsSync(resolve(__dirname, "src"))) {
	throw new Error("backend jest setup: expected to run against src/")
}
