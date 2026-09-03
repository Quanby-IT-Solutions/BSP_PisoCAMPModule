/**
 * Run a mutation whose failure the surrounding component already renders.
 *
 * TanStack Query records a `mutateAsync` failure on the mutation *and* rejects
 * the promise. A form that awaits it purely to sequence its own work, and shows
 * the error from `isError` / `error`, has nothing left to do with the
 * rejection — but letting it escape makes every failed submit an unhandled
 * rejection. In a Next.js production build that surfaces as a page error and
 * remounts the tree, which wipes the very message the person needed to read.
 *
 * So: the failure is already reported, and this says so at the call site.
 * Anything that needs to *act* on the failure should catch it itself instead.
 */
export async function alreadyReported<T>(work: Promise<T>): Promise<T | undefined> {
	try {
		return await work
	} catch {
		return undefined
	}
}
