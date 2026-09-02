import { sql } from "drizzle-orm"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { assertDisposablePostgres } from "@/test-support/destructive-database.guard"

import { renderPublishedContentResources } from "../bundle/bundle-renderer"
import { ContentWorkflowService } from "./content-workflow.service"
import { ContentService } from "./content.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

const EDITOR_ID = "ce3-editor"
const APPROVER_ID = "ce3-approver"

const securityFeature = (
	title: string,
	featureLevel: "first" | "second",
	hotspot?: { x: number; y: number }
) => ({
	contentType: "security_feature" as const,
	title,
	summary: "Approved description of a security feature.",
	body: "What to look for, in approved plain text.",
	seriesCode: "engc-banknotes" as const,
	denominationCode: "php-100",
	featureLevel,
	...(hotspot === undefined ? {} : { hotspot }),
})

function correlation(
	itemId: string,
	expectedVersionNo: number
): { itemId: string; requestId: string; expectedVersionNo: number }
function correlation(
	itemId: string,
	expectedVersionNo: number,
	comments: string
): { itemId: string; requestId: string; expectedVersionNo: number; comments: string }
function correlation(
	itemId: string,
	expectedVersionNo: number,
	comments?: string
): { itemId: string; requestId: string; expectedVersionNo: number; comments?: string } {
	return {
		itemId,
		requestId: crypto.randomUUID(),
		expectedVersionNo,
		...(comments === undefined ? {} : { comments }),
	}
}

/**
 * CE-3 / BR-012. A second-level feature is kept out of the bundle at the one
 * place that decides what a bundle contains, so no client is trusted to hide
 * it. These tests exercise the real workflow against live PostgreSQL, because
 * the database enforces half the rule.
 */
describe("CE-3 security feature disclosure level", () => {
	let contentService: ContentService
	let workflow: ContentWorkflowService

	beforeAll(async () => {
		assertDisposablePostgres({
			allowDestructive: process.env.ALLOW_DESTRUCTIVE_DATABASE_TESTS,
			databaseUrl: process.env.DATABASE_URL,
		})
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, version_asset, asset, asset_object,
				related_link, content_version, content_item, audit_log, idempotency_keys, users
			restart identity cascade
		`)
		await db.execute(sql`
			insert into users (id, name, email, email_verified, created_at, updated_at)
			values (${EDITOR_ID}, 'CE3 Editor', 'ce3-editor@example.test', true, now(), now()),
			       (${APPROVER_ID}, 'CE3 Approver', 'ce3-approver@example.test', true, now(), now())
		`)
	})

	beforeEach(async () => {
		await db.execute(sql`
			truncate table content_bundle_rebuild_request, related_link, content_version,
				content_item, audit_log, idempotency_keys
			restart identity cascade
		`)
		const audit = new AuditService()
		contentService = new ContentService(audit)
		workflow = new ContentWorkflowService(audit)
	})

	afterAll(async () => {
		await db.$client.end()
	})

	async function publish(content: ReturnType<typeof securityFeature>) {
		const created = await contentService.create(
			{ requestId: crypto.randomUUID(), content, relatedLinks: [] },
			EDITOR_ID
		)
		await workflow.transition("submit", correlation(created.id, 1, "Ready"), EDITOR_ID)
		await workflow.transition("approve", correlation(created.id, 2, "Checked"), APPROVER_ID)
		await workflow.transition("publish", correlation(created.id, 3), APPROVER_ID)
		return created.id
	}

	it("keeps a first-level feature, with its hotspot, in the bundle", async () => {
		const itemId = await publish(securityFeature("Watermark", "first", { x: 250, y: 640 }))

		const { candidates, exclusions } = await workflow.listPublishedBundleCandidates()

		expect(exclusions).toEqual([])
		expect(candidates).toHaveLength(1)
		expect(candidates[0]).toMatchObject({
			itemId,
			content: {
				contentType: "security_feature",
				featureLevel: "first",
				hotspot: { x: 250, y: 640 },
			},
		})

		const [resource] = renderPublishedContentResources(candidates)
		const document = JSON.parse(resource!.bytes.toString("utf8")) as Record<string, unknown>
		expect(document.featureLevel).toBe("first")
		expect(document.hotspot).toEqual({ x: 250, y: 640 })
	})

	it("excludes a published second-level feature and reports it", async () => {
		const hidden = await publish(securityFeature("Microprint under UV", "second"))

		const { candidates, exclusions } = await workflow.listPublishedBundleCandidates()

		expect(candidates).toEqual([])
		expect(exclusions).toEqual([
			{
				itemId: hidden,
				versionId: expect.any(String),
				reason: "second_level_security_feature",
			},
		])
		// The item is still published: it is withheld from devices, not withdrawn.
		const rows = await db.execute<{ status: string }>(
			sql`select status from content_item where id = ${hidden}`
		)
		expect(rows.rows[0]?.status).toBe("published")
	})

	it("carries first-level features while withholding second-level ones alongside them", async () => {
		const shown = await publish(securityFeature("Embossed print", "first", { x: 10, y: 20 }))
		const hidden = await publish(securityFeature("Second-level mark", "second"))

		const { candidates, exclusions } = await workflow.listPublishedBundleCandidates()

		expect(candidates.map(candidate => candidate.itemId)).toEqual([shown])
		expect(exclusions.map(exclusion => exclusion.itemId)).toEqual([hidden])
		// A withheld feature must leave nothing behind in what is rendered.
		const rendered = renderPublishedContentResources(candidates)
		expect(rendered).toHaveLength(1)
		expect(rendered[0]!.bytes.toString("utf8")).not.toContain("Second-level mark")
	})

	it("refuses a hotspot on a feature that will never reach a device", async () => {
		await expect(
			contentService.create(
				{
					requestId: crypto.randomUUID(),
					content: securityFeature("Hidden mark", "second", { x: 100, y: 100 }),
					relatedLinks: [],
				},
				EDITOR_ID
			)
		).rejects.toThrow()

		expect(await db.execute(sql`select 1 from content_item`)).toMatchObject({ rowCount: 0 })
	})

	describe("the database enforces the rule the contract states", () => {
		/**
		 * Which CHECK refused the write. Drizzle reports "Failed query", so the
		 * constraint name lives on the driver error underneath — and naming it is
		 * the point: a test that only asserts "it threw" would pass on the wrong
		 * rule.
		 */
		async function violatedConstraint(operation: () => Promise<unknown>) {
			try {
				await operation()
				return null
			} catch (error) {
				const cause = (error as { cause?: { constraint?: string } }).cause
				return cause?.constraint ?? (error as { constraint?: string }).constraint ?? null
			}
		}

		async function insertVersion(columns: string, values: string) {
			await db.execute(
				sql.raw(`
					insert into content_item (id, content_type, status, created_by, last_edited_by)
					values ('00000000-0000-4000-8000-00000000000a', 'security_feature', 'draft',
						'${EDITOR_ID}', '${EDITOR_ID}');
					insert into content_version (id, item_id, version_no, status, content_type, title,
						summary, body, series_code, denomination_code, created_by${columns})
					values ('00000000-0000-4000-8000-00000000000b',
						'00000000-0000-4000-8000-00000000000a', 1, 'draft', 'security_feature',
						'Direct insert', 'Summary.', 'Body.', 'engc-banknotes', 'php-100',
						'${EDITOR_ID}'${values})
				`)
			)
		}

		it("requires a level on a security feature", async () => {
			expect(await violatedConstraint(() => insertVersion("", ""))).toBe(
				"content_version_feature_level_check"
			)
		})

		it("refuses a level on anything that is not a security feature", async () => {
			const constraint = await violatedConstraint(() =>
				db.execute(
					sql.raw(`
						insert into content_item (id, content_type, status, created_by, last_edited_by)
						values ('00000000-0000-4000-8000-00000000000c', 'advisory', 'draft',
							'${EDITOR_ID}', '${EDITOR_ID}');
						insert into content_version (id, item_id, version_no, status, content_type,
							title, summary, body, created_by, feature_level)
						values ('00000000-0000-4000-8000-00000000000d',
							'00000000-0000-4000-8000-00000000000c', 1, 'draft', 'advisory',
							'Advisory', 'Summary.', 'Body.', '${EDITOR_ID}', 'first')
					`)
				)
			)

			expect(constraint).toBe("content_version_feature_level_check")
		})

		it("refuses a hotspot outside the image, half a hotspot, or one on a hidden feature", async () => {
			const hotspotColumns = ", feature_level, hotspot_x_permille, hotspot_y_permille"
			const cases = [
				["past the right edge", hotspotColumns, ", 'first', 1001, 10"],
				["past the bottom edge", hotspotColumns, ", 'first', 10, 1001"],
				["only half a position", ", feature_level, hotspot_x_permille", ", 'first', 10"],
				["on a withheld feature", hotspotColumns, ", 'second', 10, 10"],
			] as const
			const refused: [string, string | null][] = []
			for (const [label, columns, values] of cases) {
				refused.push([label, await violatedConstraint(() => insertVersion(columns, values))])
			}

			// Compared as a whole so a failure names which case slipped through.
			expect(refused).toEqual(
				cases.map(([label]) => [label, "content_version_hotspot_check"])
			)
		})

		it("accepts a first-level feature anchored at either edge of the image", async () => {
			await insertVersion(
				", feature_level, hotspot_x_permille, hotspot_y_permille",
				", 'first', 0, 1000"
			)

			const rows = await db.execute<{ x: number; y: number }>(
				sql`select hotspot_x_permille as x, hotspot_y_permille as y from content_version`
			)
			expect(rows.rows[0]).toEqual({ x: 0, y: 1000 })
		})
	})
})
