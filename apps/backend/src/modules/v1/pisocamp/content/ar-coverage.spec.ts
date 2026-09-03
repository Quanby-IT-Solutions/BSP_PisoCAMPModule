import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"

import {
	AR_MANDATORY_EXPERIENCE_COUNT,
	AR_MANDATORY_EXPERIENCES,
	arExperienceKey,
} from "@repo/contracts/pisocamp-content"
import { arExperienceDetails, contentItems, contentVersions, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { readArCoverage, summariseArCoverage } from "./ar-coverage"

const ACTOR = "ar3-coverage-actor"

/**
 * AR-002/003. Every mandatory coin and banknote has a published AR experience.
 *
 * The list is BSP's, under BR-010 change control; what this proves is that the
 * check reads it faithfully and reports a gap as a gap. A coverage figure that
 * cannot fail is not a coverage figure.
 */
describe("AR-3 mandatory AR coverage", () => {
	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table ar_experience_detail, content_version, content_item,
				users restart identity cascade
		`)
		await db.insert(users).values({
			id: ACTOR,
			name: "AR-3 fixture",
			email: "ar3-coverage@test.local",
			emailVerified: true,
		})
	})

	afterAll(async () => {
		await db.$client.end()
	})

	it("requires fourteen coins and ten banknotes", () => {
		expect(AR_MANDATORY_EXPERIENCES).toHaveLength(AR_MANDATORY_EXPERIENCE_COUNT)
		const coins = AR_MANDATORY_EXPERIENCES.filter(item =>
			item.seriesCode.includes("coin")
		)
		expect(coins).toHaveLength(14)
		expect(AR_MANDATORY_EXPERIENCES).toHaveLength(coins.length + 10)

		// Two entries for the same denomination would make the count look right
		// while leaving something uncovered.
		expect(new Set(AR_MANDATORY_EXPERIENCES.map(arExperienceKey)).size).toBe(
			AR_MANDATORY_EXPERIENCE_COUNT
		)
	})

	it("reports full coverage only when every mandatory item is published", () => {
		expect(summariseArCoverage(AR_MANDATORY_EXPERIENCES)).toMatchObject({
			required: AR_MANDATORY_EXPERIENCE_COUNT,
			covered: AR_MANDATORY_EXPERIENCE_COUNT,
			missing: [],
			unexpected: [],
		})
	})

	it("names what is missing rather than reporting a percentage", () => {
		const withoutTwo = AR_MANDATORY_EXPERIENCES.slice(2)

		const report = summariseArCoverage(withoutTwo)
		expect(report.covered).toBe(AR_MANDATORY_EXPERIENCE_COUNT - 2)
		// A number tells somebody there is a hole; the names tell them which
		// coins to go and record narration for.
		expect(report.missing.map(arExperienceKey)).toEqual([
			arExperienceKey(AR_MANDATORY_EXPERIENCES[0]!),
			arExperienceKey(AR_MANDATORY_EXPERIENCES[1]!),
		])
	})

	it("reports an experience for something nobody asked for", () => {
		const report = summariseArCoverage([
			...AR_MANDATORY_EXPERIENCES,
			{ seriesCode: "engc-banknotes", denominationCode: "php-1000" },
		])

		// Either the list is out of date or somebody published an item nobody
		// approved. Both are worth a look, so neither is swallowed.
		expect(report.missing).toEqual([])
		expect(report.unexpected).toEqual(["engc-banknotes/php-1000"])
	})

	it("counts only published experiences, from the database", async () => {
		const [first, second] = AR_MANDATORY_EXPERIENCES
		await insertExperience(first!, "published")
		await insertExperience(second!, "draft")

		const report = await readArCoverage()
		// A draft is a promise, not coverage: the criterion is about what a
		// device can actually open.
		expect(report.covered).toBe(1)
		expect(report.missing.map(arExperienceKey)).toContain(arExperienceKey(second!))
	})

	async function insertExperience(
		item: { seriesCode: string; denominationCode: string },
		status: "published" | "draft"
	) {
		const itemId = randomUUID()
		const versionId = randomUUID()
		await db.insert(contentItems).values({
			id: itemId,
			contentType: "ar_experience",
			status,
			createdBy: ACTOR,
			lastEditedBy: ACTOR,
		})
		await db.insert(contentVersions).values({
			id: versionId,
			itemId,
			versionNo: 1,
			status,
			contentType: "ar_experience",
			title: `AR ${item.denominationCode}`,
			summary: "Coverage fixture",
			body: "Coverage fixture body",
			seriesCode: item.seriesCode,
			denominationCode: item.denominationCode,
			createdBy: ACTOR,
			...(status === "published"
				? {
						approvedBy: ACTOR,
						approvedAt: new Date(),
						publishedBy: ACTOR,
						publishedAt: new Date(),
						transitionAction: "publish",
					}
				: {}),
		})
		if (status === "published") {
			// Pointed at only once the version exists: the item's published
			// pointer is a foreign key, not a label.
			await db
				.update(contentItems)
				.set({ currentPublishedVersionId: versionId })
				.where(eq(contentItems.id, itemId))
		}
		await db.insert(arExperienceDetails).values({
			contentVersionId: versionId,
			contentItemId: itemId,
			seriesCode: item.seriesCode,
			denominationCode: item.denominationCode,
			minimumAndroidSdk: 26,
			minimumIosVersion: "13.0",
			animationDurationMs: 12_000,
			narrationTranscript: "Coverage fixture narration.",
		})
	}
})
