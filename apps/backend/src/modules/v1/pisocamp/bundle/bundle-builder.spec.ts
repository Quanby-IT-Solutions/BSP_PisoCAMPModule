import {
	PisoCampBundleEnvelopeSchema,
	PisoCampBundleManifestSchema,
} from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/bundle.schema"
import { Logger } from "@nestjs/common"

import { BundleBuilder } from "./bundle-builder"

jest.mock("@repo/contracts", () =>
	jest.requireActual(
		"../../../../../../../packages/contracts/src/modules/v1/pisocamp/bundle.schema"
	)
)

describe("BundleBuilder", () => {
	const now = new Date("2026-08-27T00:00:00.000Z")
	const repository = {
		claimDue: jest.fn(),
		getCurrentReady: jest.fn(),
		withBuildLock: jest.fn(),
		claimsOwned: jest.fn(),
		getReadyEntries: jest.fn(),
		completeClaims: jest.fn(),
		createBuildingBundle: jest.fn(),
		insertManifestEntries: jest.fn(),
		reconcileBundle: jest.fn(),
		promote: jest.fn(),
		failOwnedClaims: jest.fn(),
		recordFailedBundle: jest.fn(),
	}
	const objectStore = { putVerified: jest.fn() }
	const signer = {
		sign: jest.fn().mockResolvedValue({
			algorithm: "Ed25519",
			keyId: "ce1-test-v1",
			signature:
				"VM6GLom2CWon4Kw-T2c5lXlD61bzb8egSAEh6iIoq2htPacpe7fXjR29bTZgrNisWa5oWb8YqAgc6PWgipU3Aw",
		}),
	}
	const workflow = { listPublishedBundleCandidates: jest.fn() }

	beforeEach(() => {
		jest.clearAllMocks()
		repository.claimDue.mockResolvedValue([])
		repository.getCurrentReady.mockResolvedValue(null)
		repository.withBuildLock.mockImplementation(async (work: (tx: object) => unknown) => work({}))
		repository.claimsOwned.mockResolvedValue(true)
		repository.createBuildingBundle.mockResolvedValue({
			id: "44444444-4444-4444-8444-444444444444",
			version: 1n,
		})
		repository.reconcileBundle.mockResolvedValue({ entryCount: 0, coreByteLength: 0 })
		repository.promote.mockResolvedValue(true)
		workflow.listPublishedBundleCandidates.mockResolvedValue({ candidates: [], exclusions: [] })
	})


	it("warns for each second-level feature the build leaves out", async () => {
		const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
		workflow.listPublishedBundleCandidates.mockResolvedValue({
			candidates: [],
			exclusions: [
				{
					itemId: "11111111-1111-4111-8111-111111111111",
					versionId: "22222222-2222-4222-8222-222222222222",
					reason: "second_level_security_feature",
				},
				{
					itemId: "33333333-3333-4333-8333-333333333333",
					versionId: "44444444-4444-4444-8444-444444444444",
					reason: "second_level_security_feature",
				},
			],
		})
		const builder = new BundleBuilder(
			repository as never,
			objectStore as never,
			signer,
			workflow as never,
			{ leaseSeconds: 120, batchSize: 50, owner: "builder-a" },
			() => now
		)

		try {
			await expect(builder.buildNextBundle("bootstrap")).resolves.toMatchObject({
				outcome: "built",
			})

			expect(warn.mock.calls.map(call => call[0])).toEqual([
				"bundle_content_excluded reason=second_level_security_feature item=11111111-1111-4111-8111-111111111111 version=22222222-2222-4222-8222-222222222222",
				"bundle_content_excluded reason=second_level_security_feature item=33333333-3333-4333-8333-333333333333 version=44444444-4444-4444-8444-444444444444",
			])
			// One argument per call: the line above is the whole warning, so no
			// second parameter can carry editor-supplied text alongside it.
			expect(warn.mock.calls.every(call => call.length === 1)).toBe(true)
		} finally {
			warn.mockRestore()
		}
	})

	it("builds and schema-validates an empty bootstrap bundle", async () => {
		const builder = new BundleBuilder(
			repository as never,
			objectStore as never,
			signer,
			workflow as never,
			{ leaseSeconds: 120, batchSize: 50, owner: "builder-a" },
			() => now
		)

		await expect(builder.buildNextBundle("bootstrap")).resolves.toEqual({
			outcome: "built",
			bundleVersion: "1",
		})

		const promotion = repository.promote.mock.calls[0]![1]
		const envelope = PisoCampBundleEnvelopeSchema.parse(promotion.envelope)
		const manifest = PisoCampBundleManifestSchema.parse(
			JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"))
		)
		expect(manifest).toEqual({
			schemaVersion: 1,
			bundleVersion: "1",
			generatedAt: "2026-08-27T00:00:00.000Z",
			minimumClientSchemaVersion: 1,
			entries: [],
		})
		expect(repository.insertManifestEntries).toHaveBeenCalledWith(
			expect.anything(),
			"44444444-4444-4444-8444-444444444444",
			[]
		)
	})

	it("does not allocate a version when a ready bundle has no due request", async () => {
		repository.getCurrentReady.mockResolvedValue({ id: "ready", version: 9n })
		const builder = new BundleBuilder(
			repository as never,
			objectStore as never,
			signer,
			workflow as never,
			{ leaseSeconds: 120, batchSize: 50, owner: "builder-a" },
			() => now
		)

		await expect(builder.buildNextBundle("interval")).resolves.toEqual({
			outcome: "unchanged",
			bundleVersion: "9",
		})
		expect(repository.withBuildLock).not.toHaveBeenCalled()
		expect(repository.createBuildingBundle).not.toHaveBeenCalled()
	})

	it("moves an owned claim to failure when the current-ready lookup fails", async () => {
		const claim = {
			id: "55555555-5555-4555-8555-555555555555",
			itemId: "11111111-1111-4111-8111-111111111111",
			publishedVersionId: "22222222-2222-4222-8222-222222222222",
			attemptCount: 1,
		}
		repository.claimDue.mockResolvedValue([claim])
		repository.getCurrentReady.mockRejectedValue(
			Object.assign(new Error("database detail"), { code: "ready_lookup_failed" })
		)
		const builder = new BundleBuilder(
			repository as never,
			objectStore as never,
			signer,
			workflow as never,
			{ leaseSeconds: 120, batchSize: 50, owner: "builder-a" },
			() => now
		)

		await expect(builder.buildNextBundle("interval")).rejects.toMatchObject({
			code: "ready_lookup_failed",
		})
		expect(repository.failOwnedClaims).toHaveBeenCalledWith(
			[claim],
			"builder-a",
			now,
			expect.objectContaining({ code: "ready_lookup_failed" })
		)
	})
})
