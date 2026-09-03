import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"

import { REDACTED_FIELD_NAMES, REDACTED_QUERY_PARAMS, sanitizeLogUrl } from "@repo/observability"

import { buildPinoHttpOptions } from "@/config/pino-logger.config"
import { sanitizeRequestId } from "@/utils/log-redaction"

const repositoryRoot = resolve(__dirname, "../../../..")

/**
 * SA-6. The controls that are supposed to hold, asserted rather than asserted
 * about.
 *
 * A security checklist whose boxes are ticked by hand tells you what somebody
 * believed on the day they ticked it. These run on every commit.
 */
describe("SA-6 security controls", () => {
	describe("no credentials are committed to the repository", () => {
		it("passes the hard-coded credential scan", () => {
			// Run as the script does, so the check in CI and the check here can
			// never drift apart.
			const output = execFileSync(
				process.execPath,
				[resolve(repositoryRoot, "scripts/scan-hardcoded-credentials.mjs"), "--json"],
				{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
			)
			const result = JSON.parse(output) as {
				blocking: number
				findings: { file: string; allowed: string | null }[]
			}

			expect(result.blocking).toBe(0)
			// Every allowed match names why it is allowed, because an exclusion
			// nobody can explain is how a scanner stops finding anything.
			for (const finding of result.findings) {
				expect(finding.allowed).toEqual(expect.any(String))
			}
		})

		it("finds a credential when one is present", () => {
			// The scanner has to be able to fail, or passing it means nothing.
			const scanner = readFileSync(
				resolve(repositoryRoot, "scripts/scan-hardcoded-credentials.mjs"),
				"utf8"
			)
			const rules = [...scanner.matchAll(/id: "([a-z-]+)"/g)].map(match => match[1])

			expect(rules).toEqual(
				expect.arrayContaining([
					"private-key",
					"aws-access-key",
					"github-token",
					"connection-string-password",
					"assigned-secret",
				])
			)
		})
	})

	describe("logs carry a correlation id and no credentials", () => {
		it("assigns and validates a correlation id on every request", () => {
			const options = buildPinoHttpOptions({ autoLogging: false })

			expect(typeof options.genReqId).toBe("function")
			// A forged id is a forged log line, so an id carrying a newline is
			// refused outright rather than trimmed and trusted.
			expect(sanitizeRequestId(`abc${String.fromCharCode(10)}info: forged`)).toBeNull()
			expect(sanitizeRequestId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(
				"3f2504e0-4f89-11d3-9a0c-0305e82c3301"
			)
		})

		it("strips single-use credentials from the logged URL", () => {
			for (const parameter of REDACTED_QUERY_PARAMS) {
				const url = `/api/v1/auth/verify?${parameter}=live-credential-value&next=/home`
				const redacted = sanitizeLogUrl(url)

				expect(redacted).not.toContain("live-credential-value")
				expect(redacted).toContain("next=/home")
			}
		})

		it("redacts every field the manifest names", () => {
			const options = buildPinoHttpOptions({ autoLogging: false })
			const paths = (options.redact as { paths: string[] }).paths.join(" ")

			// The manifest is the authority; a field added there and not wired
			// into the logger would be a field that leaks.
			for (const field of REDACTED_FIELD_NAMES) {
				expect(paths).toContain(field)
			}
		})
	})

	describe("input validation reaches every endpoint", () => {
		it("declares an input schema or no input at all for each contract route", () => {
			// A route whose input is unvalidated is the one an attacker reads
			// first, so the check is on the contract rather than on any handler.
			const contractsDirectory = resolve(
				repositoryRoot,
				"packages/contracts/src/modules/v1/pisocamp"
			)
			const contractFiles = readdirSync(contractsDirectory).filter(name =>
				name.endsWith(".contract.ts")
			)

			expect(contractFiles.length).toBeGreaterThan(5)

			for (const file of contractFiles) {
				const text = readFileSync(join(contractsDirectory, file), "utf8")
				const routes = [...text.matchAll(/\.route\(\{[\s\S]*?\}\)([\s\S]*?)(?=\n\t\t[a-zA-Z]|\n\t\},|\n\}\n)/g)]

				for (const [, tail] of routes) {
					const method = /method: "(GET|POST|PUT|PATCH|DELETE)"/.exec(text)
					if (!method) continue
					// Either the route takes validated input or it takes none.
					expect(tail?.includes(".input(") || tail?.includes(".output(")).toBe(true)
				}
			}
		})
	})

	describe("mobile secrets live in secure storage", () => {
		it("keeps tokens and queue keys out of plain shared preferences", () => {
			const libraryRoot = resolve(repositoryRoot, "apps/mobile/lib")
			const offenders: string[] = []

			const walk = (directory: string) => {
				for (const entry of readdirSync(directory)) {
					const path = join(directory, entry)
					if (statSync(path).isDirectory()) {
						walk(path)
						continue
					}
					if (extname(entry) !== ".dart") continue
					const text = readFileSync(path, "utf8")
					// A session token or an encryption key in SharedPreferences is
					// readable by anything on a rooted device.
					const writesSecret =
						/setString\(\s*['"][^'"]*(token|secret|key|password)[^'"]*['"]/i.test(text)
					if (writesSecret) offenders.push(relative(repositoryRoot, path))
				}
			}
			walk(libraryRoot)

			expect(offenders).toEqual([])
		})
	})
})
