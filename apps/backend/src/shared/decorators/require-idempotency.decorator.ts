import { SetMetadata } from "@nestjs/common"

export const IDEMPOTENCY_REQUIREMENT_KEY = "idempotency.requirement"

export interface IdempotencyRequirement {
	requestIdField: "id" | "requestId"
	requireActiveAccount: boolean
}

export const RequireIdempotency = (requirement: IdempotencyRequirement) =>
	SetMetadata(IDEMPOTENCY_REQUIREMENT_KEY, requirement)
