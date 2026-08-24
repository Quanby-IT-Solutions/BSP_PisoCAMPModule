const DEVICE_PSEUDO_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** Runtime mirror of the public contract without importing the ESM contract router into Jest. */
export function isDevicePseudoId(value: unknown): value is string {
	return typeof value === "string" && DEVICE_PSEUDO_ID_PATTERN.test(value)
}
