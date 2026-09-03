#!/usr/bin/env node
/**
 * SA-6. The dependency and third-party inventory, generated from the lockfiles.
 *
 * Generated rather than maintained by hand, because an inventory somebody has
 * to remember to update is an inventory that is wrong the first time somebody
 * forgets. The lockfiles are the only record of what actually ships.
 *
 * Usage:
 *   node scripts/security-inventory.mjs            # write docs/security/dependency-inventory.md
 *   node scripts/security-inventory.mjs --check    # fail if the file is out of date
 */

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUTPUT = resolve(root, "docs/security/dependency-inventory.md")

/**
 * Every package in the pnpm lockfile, with the workspaces that ask for it
 * directly.
 *
 * The lockfile is read as text rather than parsed as YAML on purpose: this
 * script must run with no dependencies of its own, since an inventory that
 * needs an install to be produced cannot be produced when the install is the
 * thing under suspicion.
 */
function readPnpmLock() {
	const text = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8")
	const packages = new Map()

	const packagesSection = text.slice(text.indexOf("\npackages:"))
	// Keys are sometimes quoted, and a scoped name carries its own "@": split on
	// the last one so `@scope/name@1.2.3` reads as a name and a version.
	for (const match of packagesSection.matchAll(/^ {2}'?([^\s:']+)'?:$/gm)) {
		const key = match[1]
		const at = key.lastIndexOf("@")
		if (at <= 0) continue
		const name = key.slice(0, at)
		const version = key.slice(at + 1)
		if (!/^\d/.test(version)) continue
		if (!packages.has(name)) packages.set(name, new Set())
		packages.get(name).add(version)
	}

	const direct = new Map()
	const importersSection = text.slice(
		text.indexOf("\nimporters:"),
		text.indexOf("\npackages:")
	)
	let workspace = null
	for (const line of importersSection.split(/\r?\n/)) {
		const importer = line.match(/^ {2}([^\s:]+):$/)
		if (importer) {
			workspace = importer[1] === "." ? "(root)" : importer[1]
			continue
		}
		const dependency = line.match(/^ {6}'?([^\s:']+)'?:$/)
		if (dependency && workspace) {
			const name = dependency[1]
			if (!direct.has(name)) direct.set(name, new Set())
			direct.get(name).add(workspace)
		}
	}

	return { packages, direct }
}

/** The Flutter side, from its own lockfile. */
function readPubLock() {
	const path = resolve(root, "apps/mobile/pubspec.lock")
	const text = readFileSync(path, "utf8")
	const entries = new Map()
	let current = null
	for (const line of text.split(/\r?\n/)) {
		const name = line.match(/^ {2}([a-z0-9_]+):$/)
		if (name) {
			current = name[1]
			continue
		}
		const version = line.match(/^ {4}version: "([^"]+)"$/)
		if (version && current) {
			entries.set(current, version[1])
			current = null
		}
	}
	return entries
}

function table(rows) {
	return rows.map(row => `| ${row.join(" | ")} |`).join("\n")
}

function render() {
	const { packages, direct } = readPnpmLock()
	const pub = readPubLock()

	const directRows = [...direct.entries()]
		.filter(([name]) => !name.startsWith("@repo/"))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, workspaces]) => [
			`\`${name}\``,
			[...(packages.get(name) ?? ["(workspace)"])].sort().join(", "),
			[...workspaces].sort().join(", "),
		])

	const pubRows = [...pub.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, version]) => [`\`${name}\``, version])

	const transitive = [...packages.keys()].filter(name => !direct.has(name)).length

	const body = `# Dependency and third-party inventory

**Generated** by \`node scripts/security-inventory.mjs\` from \`pnpm-lock.yaml\`
and \`apps/mobile/pubspec.lock\`. Do not edit by hand: run the script.

An inventory somebody has to remember to update is an inventory that is wrong
the first time somebody forgets, so this one is derived from the only record of
what actually ships.

- **Node packages in the lockfile:** ${packages.size}
  (${directRows.length} named directly by a workspace, ${transitive} reached through them)
- **Dart packages in \`pubspec.lock\`:** ${pub.size}

## Node dependencies named directly by a workspace

| Package | Version(s) locked | Required by |
| --- | --- | --- |
${table(directRows)}

## Flutter dependencies (\`apps/mobile/pubspec.lock\`)

| Package | Version |
| --- | --- |
${table(pubRows)}
`

	return body
}

const body = render()

if (process.argv.includes("--check")) {
	let current = ""
	try {
		current = readFileSync(OUTPUT, "utf8")
	} catch {
		current = ""
	}
	const digest = value => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex")
	if (digest(current) !== digest(body)) {
		console.error(
			"docs/security/dependency-inventory.md is out of date. Run: node scripts/security-inventory.mjs"
		)
		process.exit(1)
	}
	console.log("dependency inventory is up to date")
} else {
	writeFileSync(OUTPUT, body, "utf8")
	console.log(`wrote ${OUTPUT}`)
}
