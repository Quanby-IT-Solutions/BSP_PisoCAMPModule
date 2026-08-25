import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
	PreconditionFailedException,
	UnauthorizedException,
	type Provider,
} from "@nestjs/common"
import { and, desc, eq } from "drizzle-orm"

import type { DBClient } from "@repo/db/client"
import {
	PISOCAMP_LOCATION_CATALOG,
	PISOCAMP_LOCATION_CATALOG_SHA256,
	PISOCAMP_LOCATION_SOURCE_URL,
	PISOCAMP_LOCATION_VERSION,
} from "@repo/db/pisocamp-location-catalog"
import {
	consentRecords,
	moduleConfiguration,
	pisoCampAccountState,
	pisoCampCities,
	pisoCampDeviceAccountLinks,
	pisoCampProfiles,
	roles,
	userRoles,
	users,
} from "@repo/db/schema"

import {
	databaseTransactionContext,
	type DatabaseTransaction,
} from "@/common/database/database-transaction.context"
import { db } from "@/common/database/database.client"
import type { V1Inputs, V1Outputs } from "@/config/contract-types"

export const PISOCAMP_PROFILE_DATABASE = Symbol("PISOCAMP_PROFILE_DATABASE")
export const PISOCAMP_PROFILE_TRANSACTIONS = Symbol("PISOCAMP_PROFILE_TRANSACTIONS")
export interface ProfileTransactionRunner {
	transaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T>
}
export const pisoCampProfileDatabaseProvider: Provider = {
	provide: PISOCAMP_PROFILE_DATABASE,
	useValue: db,
}
export const pisoCampProfileTransactionProvider: Provider = {
	provide: PISOCAMP_PROFILE_TRANSACTIONS,
	useValue: databaseTransactionContext,
}

@Injectable()
export class PisoCampProfileService {
	constructor(
		@Inject(PISOCAMP_PROFILE_DATABASE) private readonly database: DBClient,
		@Inject(PISOCAMP_PROFILE_TRANSACTIONS) private readonly transactions: ProfileTransactionRunner
	) {}

	getLocations(): V1Outputs["pisocamp"]["locations"]["get"] {
		return {
			version: PISOCAMP_LOCATION_VERSION,
			sourceUrl: PISOCAMP_LOCATION_SOURCE_URL,
			catalogSha256: PISOCAMP_LOCATION_CATALOG_SHA256,
			regions: PISOCAMP_LOCATION_CATALOG.map(region => ({
				code: region.code,
				name: region.name,
				cities: region.cities.map(city => ({ ...city })),
			})),
		}
	}

	async getProfile(accountId: string): Promise<V1Outputs["pisocamp"]["profile"]["get"]> {
		const [state] = await this.database
			.select({ status: pisoCampAccountState.status })
			.from(pisoCampAccountState)
			.where(eq(pisoCampAccountState.accountId, accountId))
			.limit(1)
		if (state?.status === "deactivated") throw new UnauthorizedException("Account is deactivated")
		return this.readProfile(this.database, accountId)
	}

	async completeProfile(
		accountId: string,
		devicePseudoId: string,
		input: V1Inputs["pisocamp"]["profile"]["upsert"]
	): Promise<V1Outputs["pisocamp"]["profile"]["upsert"]> {
		return this.transactions.transaction(async tx => {
			const [state] = await tx
				.select({ status: pisoCampAccountState.status })
				.from(pisoCampAccountState)
				.where(eq(pisoCampAccountState.accountId, accountId))
				.limit(1)
			if (state?.status === "deactivated") throw new UnauthorizedException("Account is deactivated")

			const [city] = await tx
				.select({ code: pisoCampCities.code })
				.from(pisoCampCities)
				.where(
					and(
						eq(pisoCampCities.code, input.cityCode),
						eq(pisoCampCities.regionCode, input.regionCode)
					)
				)
				.limit(1)
			if (!city) throw new BadRequestException("City does not belong to region")

			const [existingProfile] = await tx
				.select({ accountId: pisoCampProfiles.accountId })
				.from(pisoCampProfiles)
				.where(eq(pisoCampProfiles.accountId, accountId))
				.limit(1)
			if (existingProfile) throw new ConflictException("Piso CAMP profile is already complete")

			const [configuration] = await tx
				.select({ value: moduleConfiguration.value })
				.from(moduleConfiguration)
				.where(eq(moduleConfiguration.key, "active_privacy_notice_version"))
				.limit(1)
			if (typeof configuration?.value !== "string")
				throw new PreconditionFailedException("Current registration consent required")

			const [accountConsent] = await tx
				.select()
				.from(consentRecords)
				.where(
					and(
						eq(consentRecords.purpose, "registration"),
						eq(consentRecords.noticeVersion, configuration.value),
						eq(consentRecords.accountId, accountId)
					)
				)
				.orderBy(desc(consentRecords.recordedAt), desc(consentRecords.respondedAt))
				.limit(1)
			const [deviceConsent] = accountConsent
				? []
				: await tx
						.select()
						.from(consentRecords)
						.where(
							and(
								eq(consentRecords.purpose, "registration"),
								eq(consentRecords.noticeVersion, configuration.value),
								eq(consentRecords.devicePseudoId, devicePseudoId)
							)
						)
						.orderBy(desc(consentRecords.recordedAt), desc(consentRecords.respondedAt))
						.limit(1)
			const consent = accountConsent ?? deviceConsent
			if (!consent || consent.status !== "granted")
				throw new PreconditionFailedException("Current registration consent required")

			const [link] = await tx
				.select()
				.from(pisoCampDeviceAccountLinks)
				.where(eq(pisoCampDeviceAccountLinks.devicePseudoId, devicePseudoId))
				.limit(1)
			if (link && link.accountId !== accountId)
				throw new ConflictException("Device is already linked to another account")
			if (!link)
				await tx
					.insert(pisoCampDeviceAccountLinks)
					.values({ devicePseudoId, accountId, registrationConsentRecordId: consent.id })

			await tx.insert(pisoCampProfiles).values({
				accountId,
				gender: input.gender,
				age: input.age,
				regionCode: input.regionCode,
				cityCode: input.cityCode,
				registrationConsentRecordId: consent.id,
			})
			const [registeredRole] = await tx
				.select({ id: roles.id })
				.from(roles)
				.where(eq(roles.name, "Registered End User"))
				.limit(1)
			if (!registeredRole) throw new NotFoundException("Registered End User role is unavailable")
			await tx
				.insert(userRoles)
				.values({ userId: accountId, roleId: registeredRole.id })
				.onConflictDoNothing()
			return this.readProfile(tx, accountId)
		})
	}

	private async readProfile(
		database: Pick<DBClient, "select">,
		accountId: string
	): Promise<V1Outputs["pisocamp"]["profile"]["get"]> {
		const [user] = await database
			.select({ name: users.name, email: users.email })
			.from(users)
			.where(eq(users.id, accountId))
			.limit(1)
		if (!user) throw new UnauthorizedException("Authentication required")
		const [profile] = await database
			.select()
			.from(pisoCampProfiles)
			.where(eq(pisoCampProfiles.accountId, accountId))
			.limit(1)
		return profile
			? {
					status: "complete",
					missingFields: [],
					name: user.name,
					email: user.email,
					profile: {
						gender: profile.gender,
						age: profile.age,
						regionCode: profile.regionCode,
						cityCode: profile.cityCode,
						registrationConsentRecordId: profile.registrationConsentRecordId,
					},
				}
			: {
					status: "missing",
					missingFields: ["gender", "age", "regionCode", "cityCode"],
					name: user.name,
					email: user.email,
					profile: null,
				}
	}
}
