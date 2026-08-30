import { Logger } from "@nestjs/common"

import fixture from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json"
import { BundleWorker } from "./bundle-worker"

describe("BundleWorker", () => {
	beforeEach(() => jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined))
	afterEach(() => jest.restoreAllMocks())

	it("does nothing when disabled", async () => {
		const buildNextBundle = jest.fn()
		const worker = new BundleWorker({ buildNextBundle } as never, false)

		await worker.runOnce("interval")

		expect(buildNextBundle).not.toHaveBeenCalled()
	})

	it("keeps concurrent ticks single-flight", async () => {
		let release!: () => void
		const pending = new Promise<void>(resolve => (release = resolve))
		const buildNextBundle = jest.fn(async () => {
			await pending
			return { outcome: "unchanged" as const, bundleVersion: null }
		})
		const worker = new BundleWorker({ buildNextBundle } as never, true)

		const first = worker.runOnce("interval")
		const second = worker.runOnce("interval")
		release()
		await Promise.all([first, second])

		expect(buildNextBundle).toHaveBeenCalledTimes(1)
	})

	it("catches failures and logs only stable structured metadata", async () => {
		const privateKeySentinel = fixture.privateKeyPkcs8Pem
			.replace(/-----[^-]+-----|\s/g, "")
			.slice(0, 24)
		const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)
		const worker = new BundleWorker(
			{
				buildNextBundle: jest.fn().mockRejectedValue(
					Object.assign(new Error(`private title ${privateKeySentinel}`), {
						code: "customer_secret_value",
					})
				),
			} as never,
			true
		)

		await expect(worker.runOnce("bootstrap")).resolves.toBeUndefined()

		const logged = JSON.stringify(error.mock.calls)
		expect(logged).toContain("bundle_build_failed")
		expect(logged).toContain('"attempt":1')
		expect(logged).toContain('"count":1')
		expect(logged).not.toContain("private title")
		expect(logged).not.toContain("customer_secret_value")
		expect(logged).not.toContain(privateKeySentinel)
	})
})
