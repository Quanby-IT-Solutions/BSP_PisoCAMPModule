import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repositoryRoot = resolve(__dirname, "../../../../../../..")
const harness = resolve(repositoryRoot, "scripts/recognition-accuracy-harness.mjs")
const datasetPath = resolve(
	repositoryRoot,
	"docs/pisocamp/fixtures/recognition-harness-dataset.example.json"
)
const runsPath = resolve(
	repositoryRoot,
	"docs/pisocamp/fixtures/recognition-harness-runs.example.json"
)

interface Report {
	modelVersion: string | null
	thresholds: { confidence: number; dwellSeconds: number | null }
	attempted: number
	missingSamples: string[]
	recognitionAccuracy: number
	classificationAccuracy: number
	wrongClaimRate: number
	failureRate: number
	responseTimeMs: { p50: number | null; p95: number | null; max: number | null }
	perClass: { key: string; classificationAccuracy: number; failureRate: number }[]
	perDevice: { key: string }[]
	perVariant: { key: string }[]
}

function run(args: string[]): { status: number; stdout: string } {
	try {
		return {
			status: 0,
			stdout: execFileSync(process.execPath, [harness, ...args], { encoding: "utf8" }),
		}
	} catch (error) {
		const failure = error as { status?: number; stdout?: string }
		return { status: failure.status ?? 1, stdout: failure.stdout ?? "" }
	}
}

function report(extra: string[] = []): Report {
	const result = run(["--dataset", datasetPath, "--runs", runsPath, "--json", ...extra])
	expect(result.status).toBe(0)
	return JSON.parse(result.stdout) as Report
}

/**
 * DR-4. The figures UAT is judged on, computed the way the report computes
 * them.
 *
 * Run as the CLI runs, so the number in a report attached to the TCP and the
 * number asserted here can never drift apart.
 */
describe("DR-4 recognition accuracy harness", () => {
	it("reports the four figures the criterion names", () => {
		const result = report()

		// Recomputed by hand from the five worked runs in the fixture:
		// s1 right, s2 below threshold, s3 right, s4 right, s5 wrong class.
		expect(result.attempted).toBe(5)
		expect(result.recognitionAccuracy).toBe(80)
		expect(result.classificationAccuracy).toBe(60)
		expect(result.failureRate).toBe(20)
		expect(result.wrongClaimRate).toBe(20)
		expect(result.responseTimeMs).toEqual({ p50: 700, p95: 1200, max: 1200 })
	})

	it("breaks the figures down per class, per device and per variant", () => {
		const result = report()

		expect(result.perDevice.map(entry => entry.key)).toEqual(["iphone-13", "pixel-7"])
		expect(result.perVariant.map(entry => entry.key)).toEqual(["daylight", "dim", "worn"])
		// The class nobody read confidently fails outright rather than being
		// averaged away: a class the model cannot see is what a per-class figure
		// exists to surface.
		expect(result.perClass.find(entry => entry.key === "1")).toMatchObject({
			classificationAccuracy: 0,
			failureRate: 100,
		})
	})

	it("applies the threshold itself rather than trusting the device", () => {
		// The same recorded runs, replayed at a lower bar: the 0.72 reading now
		// counts, and it happens to be right. Being able to do this without going
		// back to the lab is the point of recording raw confidences.
		const lower = report(["--confidence", "0.7"])
		expect(lower.failureRate).toBe(0)
		expect(lower.classificationAccuracy).toBe(80)

		// And at a bar nothing clears, the module would claim nothing at all.
		const higher = report(["--confidence", "0.99"])
		expect(higher.classificationAccuracy).toBe(0)
		expect(higher.wrongClaimRate).toBe(0)
		expect(higher.failureRate).toBe(100)
	})

	it("names a sample nobody ran instead of scoring it", () => {
		const directory = mkdtempSync(join(tmpdir(), "dr4-harness-"))
		const dataset = join(directory, "dataset.json")
		writeFileSync(
			dataset,
			JSON.stringify({
				samples: [
					{ id: "s1", expectedOutcome: "denomination", expectedClassId: 0 },
					{ id: "never-run", expectedOutcome: "denomination", expectedClassId: 1 },
				],
			}),
			"utf8"
		)

		const result = run(["--dataset", dataset, "--runs", runsPath, "--json"])
		expect(result.status).toBe(0)
		const parsed = JSON.parse(result.stdout) as Report
		// A hole in the evidence is reported as a hole. Counting it as a pass
		// would let an untested class reach UAT looking measured.
		expect(parsed.missingSamples).toEqual(["never-run"])
		expect(parsed.attempted).toBe(1)
	})

	it("refuses inputs it cannot score", () => {
		const directory = mkdtempSync(join(tmpdir(), "dr4-harness-bad-"))
		const empty = join(directory, "empty.json")
		writeFileSync(empty, JSON.stringify({ samples: [] }), "utf8")

		expect(run(["--dataset", empty, "--runs", runsPath, "--json"]).status).toBe(2)
		expect(run(["--dataset", datasetPath, "--json"]).status).toBe(2)
	})

	it("renders a report a person can read", () => {
		const result = run(["--dataset", datasetPath, "--runs", runsPath])

		expect(result.status).toBe(0)
		expect(result.stdout).toContain("Recognition accuracy: **80%**")
		expect(result.stdout).toContain("Response time p50 / p95: **700 ms / 1200 ms**")
		// The three figures are easy to confuse, so the report says which is
		// which rather than leaving a reader to guess why they differ.
		expect(result.stdout).toContain("wrong-claim rate")
	})
})
