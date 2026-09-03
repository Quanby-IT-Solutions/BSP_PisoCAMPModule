#!/usr/bin/env node
/**
 * DR-4. The accuracy harness (DR-008/009, §11.2).
 *
 * UAT cannot start until the approved thresholds are demonstrably met, and
 * "demonstrably" means a number somebody can recompute. This takes the approved
 * dataset, the raw results a device produced for it, and the model's own
 * thresholds, and reports what the module would actually have told people.
 *
 * It applies the threshold itself rather than trusting the device's verdict,
 * which is the whole point: a run recorded once can be replayed against several
 * candidate thresholds without going back to the lab.
 *
 * Usage:
 *   node scripts/recognition-accuracy-harness.mjs \
 *     --dataset docs/pisocamp/fixtures/dataset.json \
 *     --runs out/device-runs.json \
 *     [--descriptor out/recognition-model.active.json] \
 *     [--confidence 0.82] [--json] [--out report.md]
 */

import { readFileSync, writeFileSync } from "node:fs"
import { argv, exit, stdout } from "node:process"

/** Outcomes the module can report about a note. */
const OUTCOMES = new Set(["denomination", "demonetized", "foreign"])

export class HarnessInputError extends Error {}

function percentile(sorted, fraction) {
	if (sorted.length === 0) return null
	// Nearest-rank. With twenty samples an interpolated p95 invents a number
	// between two real measurements; the rank is one that actually happened.
	const rank = Math.ceil(fraction * sorted.length)
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

/**
 * What the module would have concluded for one recorded run.
 *
 * Below the threshold nothing is claimed, whatever the device believed at the
 * time — the same rule the scanner applies, restated here so a report can never
 * credit a reading the app would have refused.
 */
export function verdictFor(run, classes, confidence) {
	if (typeof run.confidence !== "number" || run.confidence < confidence) {
		return { outcome: "unrecognized", classId: null }
	}
	const match = classes.get(run.classId)
	if (!match) return { outcome: "unrecognized", classId: null }
	return { outcome: match.outcome, classId: run.classId }
}

export function computeAccuracyReport({ dataset, runs, classes, confidence, dwellSeconds }) {
	if (!Array.isArray(dataset?.samples) || dataset.samples.length === 0) {
		throw new HarnessInputError("dataset must carry at least one sample")
	}
	if (!Array.isArray(runs?.results)) {
		throw new HarnessInputError("runs must carry a results array")
	}
	if (!(classes instanceof Map) || classes.size === 0) {
		throw new HarnessInputError("a class list is required")
	}
	if (typeof confidence !== "number" || confidence < 0.5 || confidence > 1) {
		throw new HarnessInputError("confidence must be between 0.5 and 1")
	}

	const bySample = new Map()
	for (const run of runs.results) {
		if (!bySample.has(run.sampleId)) bySample.set(run.sampleId, [])
		bySample.get(run.sampleId).push(run)
	}

	const perClass = new Map()
	const perDevice = new Map()
	const perVariant = new Map()
	const latencies = []
	let attempted = 0
	let recognisedCorrectly = 0
	let classifiedCorrectly = 0
	let wrongClaims = 0
	const missingSamples = []

	for (const sample of dataset.samples) {
		if (!OUTCOMES.has(sample.expectedOutcome)) {
			throw new HarnessInputError(`sample ${sample.id} has an unknown expected outcome`)
		}
		const sampleRuns = bySample.get(sample.id) ?? []
		if (sampleRuns.length === 0) {
			// Never silently treated as a pass or a failure: a sample nobody ran
			// is a hole in the evidence, and the report says so by name.
			missingSamples.push(sample.id)
			continue
		}

		for (const run of sampleRuns) {
			attempted += 1
			const verdict = verdictFor(run, classes, confidence)
			const rightKind = verdict.outcome === sample.expectedOutcome
			const rightClass = rightKind && verdict.classId === sample.expectedClassId
			// A wrong claim is the one that matters most: the module named
			// something, and it named the wrong thing.
			const wrongClaim = verdict.outcome !== "unrecognized" && !rightClass
			if (rightKind) recognisedCorrectly += 1
			if (rightClass) classifiedCorrectly += 1
			if (wrongClaim) wrongClaims += 1
			if (typeof run.elapsedMs === "number") latencies.push(run.elapsedMs)

			for (const [bucket, key] of [
				[perClass, String(sample.expectedClassId ?? sample.expectedOutcome)],
				[perDevice, run.device ?? "unknown"],
				[perVariant, sample.variant ?? "none"],
			]) {
				const entry = bucket.get(key) ?? { attempted: 0, correct: 0, failed: 0, wrong: 0 }
				entry.attempted += 1
				if (rightClass) entry.correct += 1
				if (verdict.outcome === "unrecognized") entry.failed += 1
				if (wrongClaim) entry.wrong += 1
				bucket.set(key, entry)
			}
		}
	}

	if (attempted === 0) throw new HarnessInputError("no dataset sample has a recorded run")
	latencies.sort((left, right) => left - right)

	const rate = (part, whole) => (whole === 0 ? 0 : Number(((part / whole) * 100).toFixed(2)))
	const summarise = bucket =>
		[...bucket.entries()]
			.map(([key, entry]) => ({
				key,
				attempted: entry.attempted,
				classificationAccuracy: rate(entry.correct, entry.attempted),
				failureRate: rate(entry.failed, entry.attempted),
				wrongClaimRate: rate(entry.wrong, entry.attempted),
			}))
			.sort((left, right) => left.key.localeCompare(right.key))

	return {
		schemaVersion: 1,
		modelVersion: runs.modelVersion ?? null,
		thresholds: { confidence, dwellSeconds: dwellSeconds ?? null },
		samples: dataset.samples.length,
		attempted,
		missingSamples,
		recognitionAccuracy: rate(recognisedCorrectly, attempted),
		classificationAccuracy: rate(classifiedCorrectly, attempted),
		wrongClaimRate: rate(wrongClaims, attempted),
		failureRate: rate(attempted - recognisedCorrectly, attempted),
		responseTimeMs: {
			p50: percentile(latencies, 0.5),
			p95: percentile(latencies, 0.95),
			max: latencies.length === 0 ? null : latencies[latencies.length - 1],
		},
		perClass: summarise(perClass),
		perDevice: summarise(perDevice),
		perVariant: summarise(perVariant),
	}
}

export function renderMarkdown(report) {
	const table = (title, rows) =>
		[
			`### ${title}`,
			"",
			"| | attempted | classification | failure | wrong claim |",
			"| --- | ---: | ---: | ---: | ---: |",
			...rows.map(
				row =>
					`| ${row.key} | ${row.attempted} | ${row.classificationAccuracy}% | ${row.failureRate}% | ${row.wrongClaimRate}% |`
			),
			"",
		].join("\n")

	return [
		"# Recognition accuracy report",
		"",
		`Model: ${report.modelVersion ?? "(unnamed)"}`,
		`Confidence threshold: ${report.thresholds.confidence}`,
		`Dwell: ${report.thresholds.dwellSeconds ?? "(not given)"} s`,
		"",
		`- Recognition accuracy: **${report.recognitionAccuracy}%**`,
		`- Classification accuracy: **${report.classificationAccuracy}%**`,
		`- Failure rate: **${report.failureRate}%**`,
		`- Wrong-claim rate: **${report.wrongClaimRate}%**`,
		`- Response time p50 / p95: **${report.responseTimeMs.p50} ms / ${report.responseTimeMs.p95} ms**`,
		`- Runs: ${report.attempted} over ${report.samples} samples`,
		"",
		"Recognition accuracy counts a run where the module reached the right *kind*",
		"of answer — a denomination for a circulating note, demonetized or foreign",
		"for those. Classification accuracy counts the ones where it also named the",
		"right class. The gap between them is the wrong-claim rate: runs where the",
		"module said something and the something was wrong. Read that one first.",
		"",
		report.missingSamples.length > 0
			? `- **Samples with no recorded run: ${report.missingSamples.join(", ")}**`
			: "- Every dataset sample has at least one recorded run.",
		"",
		table("Per class", report.perClass),
		table("Per device", report.perDevice),
		table("Per variant", report.perVariant),
	].join("\n")
}

export function classMapFrom(descriptor) {
	const classes = new Map()
	for (const entry of descriptor?.classes ?? []) {
		classes.set(entry.classId, entry)
	}
	return classes
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"))
	} catch (error) {
		throw new HarnessInputError(`cannot read ${path}: ${error.message}`)
	}
}

function parseArgs(args) {
	const options = {}
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (!arg.startsWith("--")) continue
		const name = arg.slice(2)
		if (name === "json") {
			options.json = true
			continue
		}
		options[name] = args[index + 1]
		index += 1
	}
	return options
}

function main() {
	const options = parseArgs(argv.slice(2))
	if (!options.dataset || !options.runs) {
		stdout.write(
			"usage: recognition-accuracy-harness --dataset <file> --runs <file> " +
				"[--descriptor <file>] [--confidence <n>] [--json] [--out <file>]\n"
		)
		exit(2)
	}

	const dataset = readJson(options.dataset)
	const runs = readJson(options.runs)
	const descriptor = options.descriptor ? readJson(options.descriptor) : runs.descriptor
	if (!descriptor) {
		throw new HarnessInputError("a model descriptor is required (--descriptor, or in the runs file)")
	}

	const report = computeAccuracyReport({
		dataset,
		runs,
		classes: classMapFrom(descriptor),
		confidence: options.confidence
			? Number(options.confidence)
			: descriptor.thresholds?.confidence,
		dwellSeconds: descriptor.thresholds?.dwellSeconds,
	})

	const rendered = options.json ? JSON.stringify(report, null, 2) : renderMarkdown(report)
	if (options.out) writeFileSync(options.out, `${rendered}\n`, "utf8")
	else stdout.write(`${rendered}\n`)
}

if (import.meta.url === `file://${argv[1]}` || argv[1]?.endsWith("recognition-accuracy-harness.mjs")) {
	try {
		main()
	} catch (error) {
		if (error instanceof HarnessInputError) {
			stdout.write(`${error.message}\n`)
			exit(2)
		}
		throw error
	}
}
