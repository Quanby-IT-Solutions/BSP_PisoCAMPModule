import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto"

import fixture from "../../../../../../../packages/contracts/src/modules/v1/pisocamp/fixtures/ce1-ed25519-vector.json"
import { createEd25519BundleSigner, Ed25519BundleSigner } from "./bundle-signer"

describe("Ed25519BundleSigner", () => {
	const privateDerBase64 = createPrivateKey(fixture.privateKeyPkcs8Pem)
		.export({ format: "der", type: "pkcs8" })
		.toString("base64")

	it("matches the CE-1 golden signature and signs the exact payload bytes", async () => {
		const signer = new Ed25519BundleSigner(fixture.keyId, privateDerBase64)
		const payload = Buffer.from(fixture.payloadUtf8Hex, "hex")

		const signed = await signer.sign(payload)

		expect(signed).toEqual({
			algorithm: "Ed25519",
			keyId: fixture.keyId,
			signature: fixture.signatureBase64url,
		})
		expect(
			verify(
				null,
				Buffer.concat([payload, Buffer.from("altered")]),
				createPublicKey(fixture.publicKeySpkiPem),
				Buffer.from(signed.signature, "base64url")
			)
		).toBe(false)
	})

	it("fails closed for missing or non-Ed25519 worker signing configuration", () => {
		expect(() => createEd25519BundleSigner({ enabled: true })).toThrow(
			"bundle_signing_config_invalid"
		)

		const rsaKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
		expect(
			() =>
				new Ed25519BundleSigner(
					"ce1-test-v1",
					rsaKey.export({ format: "der", type: "pkcs8" }).toString("base64")
				)
		).toThrow("bundle_signing_key_invalid")
	})

	it("does not require a key when the worker is disabled", () => {
		expect(createEd25519BundleSigner({ enabled: false })).toBeNull()
	})
})
