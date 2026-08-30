import { createPrivateKey, sign } from "node:crypto"

export interface BundleSigner {
	sign(payload: Uint8Array): Promise<{
		algorithm: "Ed25519"
		keyId: string
		signature: string
	}>
}

export class Ed25519BundleSigner implements BundleSigner {
	private readonly privateKey: ReturnType<typeof createPrivateKey>

	constructor(
		private readonly keyId: string,
		privateKeyBase64: string
	) {
		if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(keyId)) {
			throw new Error("bundle_signing_key_invalid")
		}
		try {
			this.privateKey = createPrivateKey({
				key: Buffer.from(privateKeyBase64, "base64"),
				format: "der",
				type: "pkcs8",
			})
		} catch {
			throw new Error("bundle_signing_key_invalid")
		}
		if (this.privateKey.type !== "private" || this.privateKey.asymmetricKeyType !== "ed25519") {
			throw new Error("bundle_signing_key_invalid")
		}
	}

	async sign(payload: Uint8Array) {
		return {
			algorithm: "Ed25519" as const,
			keyId: this.keyId,
			signature: sign(null, payload, this.privateKey).toString("base64url"),
		}
	}
}

export function createEd25519BundleSigner(config: {
	enabled: boolean
	keyId?: string
	privateKeyBase64?: string
}): BundleSigner | null {
	if (!config.enabled) return null
	if (!config.keyId || !config.privateKeyBase64) {
		throw new Error("bundle_signing_config_invalid")
	}
	return new Ed25519BundleSigner(config.keyId, config.privateKeyBase64)
}
