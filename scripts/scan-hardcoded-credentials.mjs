#!/usr/bin/env node
/**
 * SA-6. A scan for credentials committed to the repository.
 *
 * Deliberately a small, dependency-free scanner rather than a service: it has
 * to run in the same place the code is written, on a machine with no network,
 * and it has to fail the build rather than file a report somebody reads later.
 *
 * It looks for the shapes a real leak takes — a private key block, a provider
 * token with a known prefix, a connection string carrying a password, an
 * assignment of a secret-looking name to a long literal — and not for the word
 * "password", which appears legitimately in a hundred places.
 *
 * Usage: node scripts/scan-hardcoded-credentials.mjs [--json]
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const SKIP_DIRECTORIES = new Set([
	".git",
	"node_modules",
	".next",
	"dist",
	"build",
	"coverage",
	".turbo",
	".dart_tool",
	"test-results",
	"playwright-report",
	"blob-report",
	".gradle",
	"Pods",
	".claude",
	// pnpm's local store contains a symlink loop back into the repository.
	".pnpm-store",
])

const SCANNED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".dart",
	".json",
	".yaml",
	".yml",
	".env",
	".sh",
	".sql",
	".xml",
	".gradle",
	".properties",
	".plist",
])

/**
 * Files whose whole point is to hold example or test credentials.
 *
 * Each one is listed with the reason it is safe, because an exclusion nobody
 * can explain is how a scanner stops finding anything.
 */
const ALLOWED = [
	{
		pattern: /(^|\/)\.env\.example$/,
		reason: "example environment file: placeholders, not values",
	},
	{
		pattern: /(^|\/)docs\//,
		reason: "documentation: examples are written as placeholders",
	},
	{
		pattern: /\.(spec|test)\.(ts|tsx|js|mjs)$/,
		reason: "test fixture: values are generated for the test and reach nothing",
	},
	{
		pattern: /(^|\/)packages\/e2e-web\//,
		reason: "end-to-end fixtures: local test accounts on a disposable database",
	},
	{
		pattern: /(^|\/)apps\/mobile\/test\//,
		reason: "Flutter test fixtures",
	},
	{
		pattern: /(^|\/)jest\.setup\.ts$/,
		reason: "test bootstrap: a fixed test-only secret, never a deploy secret",
	},
	{
		pattern: /(^|\/)scripts\/scan-hardcoded-credentials\.mjs$/,
		reason: "this scanner: it contains the patterns it looks for",
	},
]

const RULES = [
	{
		id: "private-key",
		description: "PEM private key block",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
	},
	{
		id: "aws-access-key",
		description: "AWS access key id",
		pattern: /\bAKIA[0-9A-Z]{16}\b/,
	},
	{
		id: "google-api-key",
		description: "Google API key",
		pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
	},
	{
		id: "slack-token",
		description: "Slack token",
		pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/,
	},
	{
		id: "github-token",
		description: "GitHub token",
		pattern: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/,
	},
	{
		id: "stripe-secret",
		description: "Stripe secret key",
		pattern: /\bsk_live_[0-9A-Za-z]{16,}\b/,
	},
	{
		id: "connection-string-password",
		description: "Connection string with an embedded password",
		pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:'"@]+:[^\s:'"@]+@/,
		// A local development password is not a secret; a deployed one is.
		ignore: /:(?:password|postgres|test|example|changeme|secret123)@|@(?:localhost|127\.0\.0\.1|host\.docker\.internal|db|postgres)\b/,
	},
	{
		id: "assigned-secret",
		description: "Secret-looking name assigned a long literal",
		pattern:
			/\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|private[_-]?key|BETTER_AUTH_SECRET|SEED_ADMIN_PASSWORD)\b\s*[:=]\s*["'`][A-Za-z0-9+/_-]{24,}["'`]/i,
		// `process.env.X` and `env.X` are references, not values.
		ignore: /process\.env|import\.meta\.env|String\.fromEnvironment|\$\{/,
	},
]

function* walk(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (SKIP_DIRECTORIES.has(entry.name)) continue
		// Never follow a link: a symlinked directory is somebody else's tree,
		// and following one is how a scanner ends up walking forever.
		if (entry.isSymbolicLink()) continue
		const path = join(directory, entry.name)
		const stats = statSync(path)
		if (stats.isDirectory()) {
			yield* walk(path)
			continue
		}
		if (stats.size > 2 * 1024 * 1024) continue
		const extension = extname(entry.name)
		if (!SCANNED_EXTENSIONS.has(extension) && !entry.name.startsWith(".env")) continue
		yield path
	}
}

/**
 * A fixture that declares itself test-only.
 *
 * Content-based rather than path-based on purpose: a file has to say so about
 * itself, so a real key cannot become allowed by being moved into a directory
 * somebody once exempted.
 */
const TEST_ONLY_MARKER = /"testOnly"\s*:/

function allowanceFor(relativePath, text) {
	const byPath = ALLOWED.find(allowed => allowed.pattern.test(relativePath))
	if (byPath) return byPath
	if (relativePath.includes("/fixtures/") && TEST_ONLY_MARKER.test(text)) {
		return { reason: "fixture that declares itself test-only in its own contents" }
	}
	return undefined
}

export function scan() {
	const findings = []
	for (const path of walk(root)) {
		const relativePath = relative(root, path).replace(/\\/g, "/")
		const text = readFileSync(path, "utf8")
		const allowed = allowanceFor(relativePath, text)
		const lines = text.split(/\r?\n/)

		for (const [index, line] of lines.entries()) {
			for (const rule of RULES) {
				if (!rule.pattern.test(line)) continue
				if (rule.ignore?.test(line)) continue
				findings.push({
					file: relativePath,
					line: index + 1,
					rule: rule.id,
					description: rule.description,
					allowed: allowed?.reason ?? null,
				})
			}
		}
	}
	return findings
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const findings = scan()
	const blocking = findings.filter(finding => finding.allowed === null)

	if (process.argv.includes("--json")) {
		console.log(JSON.stringify({ findings, blocking: blocking.length }, null, 2))
	} else {
		for (const finding of blocking) {
			console.error(`${finding.file}:${finding.line}  ${finding.rule}  ${finding.description}`)
		}
		console.log(
			blocking.length === 0
				? `no hard-coded credentials found (${findings.length} allowed match${
						findings.length === 1 ? "" : "es"
					} in test and example files)`
				: `${blocking.length} possible hard-coded credential(s)`
		)
	}

	process.exit(blocking.length === 0 ? 0 : 1)
}
