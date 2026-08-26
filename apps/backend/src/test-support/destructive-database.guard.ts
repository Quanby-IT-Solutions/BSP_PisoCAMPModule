const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const DEDICATED_TEST_NAME = /(^|[_-])test(?:[_-]|$)/i

export interface DestructiveDatabaseGuardInput {
	allowDestructive: string | undefined
	databaseUrl: string | undefined
}

/**
 * Fail-closed gate for suites that truncate live PostgreSQL tables.
 *
 * A deliberate opt-in, a query-free URL, a loopback-only server, and an
 * unmistakably dedicated test database name are all required. Error messages
 * never include the URL, because it commonly embeds credentials.
 */
export function assertDisposablePostgres({
	allowDestructive,
	databaseUrl,
}: DestructiveDatabaseGuardInput): { host: string; databaseName: string } {
	if (allowDestructive !== "true") {
		throw new Error("Destructive PostgreSQL tests require ALLOW_DESTRUCTIVE_DATABASE_TESTS=true")
	}
	if (!databaseUrl) throw new Error("Destructive PostgreSQL tests require DATABASE_URL")

	let parsed: URL
	try {
		parsed = new URL(databaseUrl)
	} catch {
		throw new Error("Destructive PostgreSQL tests require a valid DATABASE_URL")
	}
	if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
		throw new Error("Destructive PostgreSQL tests require a PostgreSQL DATABASE_URL")
	}
	if (parsed.search !== "") {
		throw new Error("Destructive PostgreSQL tests do not allow DATABASE_URL query parameters")
	}
	if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
		throw new Error("Destructive PostgreSQL tests require a loopback PostgreSQL host")
	}

	const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""))
	if (!DEDICATED_TEST_NAME.test(databaseName)) {
		throw new Error("Destructive PostgreSQL tests require a dedicated test database name")
	}

	return { host: parsed.hostname, databaseName }
}
