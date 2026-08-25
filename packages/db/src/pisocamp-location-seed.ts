import type { DBClient } from "./client.js"
import {
	PISOCAMP_LOCATION_CATALOG,
	PISOCAMP_LOCATION_VERSION,
} from "./pisocamp-location-catalog.js"
import { pisoCampCities, pisoCampRegions } from "./schema.js"

/** Idempotently installs the frozen PSA catalog; existing version rows are immutable. */
export async function seedPisoCampLocations(database: Pick<DBClient, "insert">): Promise<void> {
	await database
		.insert(pisoCampRegions)
		.values(
			PISOCAMP_LOCATION_CATALOG.map(region => ({
				code: region.code,
				name: region.name,
				catalogVersion: PISOCAMP_LOCATION_VERSION,
			}))
		)
		.onConflictDoNothing()
	await database
		.insert(pisoCampCities)
		.values(
			PISOCAMP_LOCATION_CATALOG.flatMap(region =>
				region.cities.map(city => ({
					code: city.code,
					regionCode: region.code,
					name: city.name,
					catalogVersion: PISOCAMP_LOCATION_VERSION,
				}))
			)
		)
		.onConflictDoNothing()
}
