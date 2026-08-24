import { SetMetadata } from "@nestjs/common"

import type { V1Inputs } from "@/config/contract-types"

export const REQUIRED_CONSENT_KEY = "requiredConsentPurpose" as const
export type RequiredConsentPurpose = V1Inputs["pisocamp"]["consent"]["get"]["purpose"]

/** Marks a collection handler as requiring a current grant for one declared purpose. */
export const RequireConsent = (purpose: RequiredConsentPurpose) =>
	SetMetadata(REQUIRED_CONSENT_KEY, purpose)
