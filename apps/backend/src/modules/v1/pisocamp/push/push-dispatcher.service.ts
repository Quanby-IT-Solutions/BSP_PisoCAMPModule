import { Injectable } from "@nestjs/common"

import { env } from "@/config/env.config"

export interface PushMessage {
	title: string
	body: string
	deepLink: string | null
}

export interface PushTarget {
	accountId: string
	deviceToken: string
	platform: "android" | "ios" | "web"
}

export type PushDispatchOutcome =
	| { accountId: string; status: "delivered" }
	| { accountId: string; status: "failed"; reason: string }
	| { accountId: string; status: "queued" }

/**
 * SA-5's edge on the existing push service (§12).
 *
 * The module does not implement push. It hands a message and a list of tokens
 * to whatever service BSP already runs and records what came back, which is
 * why this is one small seam rather than a provider SDK spread through the
 * codebase.
 *
 * With no service configured nothing is dispatched and every delivery stays
 * **queued**: recording a delivery that never happened would make the delivery
 * rate a fiction, and recording a failure would blame a service that was never
 * asked.
 */
@Injectable()
export class PushDispatcherService {
	get configured(): boolean {
		return Boolean(env.PISOCAMP_PUSH_SERVICE_URL)
	}

	async dispatch(
		message: PushMessage,
		targets: readonly PushTarget[]
	): Promise<PushDispatchOutcome[]> {
		if (!this.configured || targets.length === 0) {
			return targets.map(target => ({ accountId: target.accountId, status: "queued" }))
		}

		try {
			const response = await fetch(env.PISOCAMP_PUSH_SERVICE_URL!, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(env.PISOCAMP_PUSH_SERVICE_TOKEN
						? { authorization: `Bearer ${env.PISOCAMP_PUSH_SERVICE_TOKEN}` }
						: {}),
				},
				body: JSON.stringify({
					title: message.title,
					body: message.body,
					deepLink: message.deepLink,
					// Tokens only: the service has no business knowing who anybody
					// is, and an account id would tell it.
					tokens: targets.map(target => ({
						token: target.deviceToken,
						platform: target.platform,
					})),
				}),
				signal: AbortSignal.timeout(10_000),
			})

			if (!response.ok) {
				return targets.map(target => ({
					accountId: target.accountId,
					status: "failed",
					reason: `push_service_http_${response.status}`,
				}))
			}

			const payload = (await response.json()) as {
				failures?: { token: string; reason?: string }[]
			}
			const failed = new Map(
				(payload.failures ?? []).map(failure => [
					failure.token,
					failure.reason ?? "push_service_rejected",
				])
			)

			return targets.map(target =>
				failed.has(target.deviceToken)
					? {
							accountId: target.accountId,
							status: "failed" as const,
							reason: failed.get(target.deviceToken)!,
						}
					: { accountId: target.accountId, status: "delivered" as const }
			)
		} catch {
			// The reason is a code, not the thrown message: an error string from
			// an outside service is not something to store unread.
			return targets.map(target => ({
				accountId: target.accountId,
				status: "failed",
				reason: "push_service_unreachable",
			}))
		}
	}
}
