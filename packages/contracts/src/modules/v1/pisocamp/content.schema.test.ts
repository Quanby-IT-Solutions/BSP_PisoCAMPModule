import { describe, expect, it } from "vitest"

import type { PisoCampContentVersion, PisoCampRelatedLinkOutput } from "../../../contracts.js"
import {
	CONTENT_STATUSES,
	CONTENT_TYPES,
	CreatePisoCampContentInputSchema,
	ListPisoCampContentInputSchema,
	ListPisoCampContentOutputSchema,
	PisoCampContentDetailSchema,
	PisoCampContentDraftSchema,
	PisoCampContentStatusSchema,
	PisoCampContentSummarySchema,
	PisoCampContentTypeSchema,
	PisoCampCurrencyCatalogSchema,
	PisoCampRelatedLinkInputSchema,
	UpdatePisoCampContentInputSchema,
} from "./content.schema.js"

const requestId = "8bdc754e-3d04-4eab-b98c-523f378ac1e4"
const itemId = "7f56ed49-f06d-46f1-a8a3-5f438c4c9d9f"
const versionId = "fd21cf65-807b-4546-a7ed-e803d28568d2"
const editor = { id: "content-editor-1", name: "Content Editor" } as const
const timestamp = "2026-08-25T02:03:04.000Z"

const currencyDrafts = [
	{
		contentType: "banknote",
		title: "20-Piso New Generation Currency Banknote",
		summary: "Approved educational summary",
		body: "Approved plain-text description.",
		seriesCode: "ngc-banknotes",
		denominationCode: "php-20",
	},
	{
		contentType: "coin",
		title: "20-Piso New Generation Currency Coin",
		summary: "Approved educational summary",
		body: "Approved plain-text description.",
		seriesCode: "ngc-coins",
		denominationCode: "php-20",
	},
	{
		contentType: "security_feature",
		title: "Security thread",
		summary: "A denomination-specific security feature",
		body: "Approved plain-text description.",
		seriesCode: "engc-banknotes",
		denominationCode: "php-100",
	},
] as const

const advisoryDraft = {
	contentType: "advisory",
	title: "Proper currency handling",
	summary: "Handle currency with care.",
	body: "Approved plain-text advisory.",
} as const

const linkDraft = {
	contentType: "link",
	title: "BSP currency resources",
	summary: "Official BSP information.",
	primaryUrl: "https://www.bsp.gov.ph/Pages/CoinsAndNotes/CoinsAndNotes.aspx",
} as const

const relatedLinks = [
	{ kind: "external", label: "BSP website", url: "https://www.bsp.gov.ph/" },
	{ kind: "internal", label: "Currency home", route: "/pisocamp/currency" },
	{
		kind: "topic",
		label: "Related topic",
		targetContentItemId: "c3460484-439f-4f33-b89b-a3d877f1ee51",
	},
] as const

function createInput(content: unknown = currencyDrafts[0], links: unknown = []) {
	return { requestId, content, relatedLinks: links }
}

describe("CM-1 draft input schemas", () => {
	it("accepts every frozen content variant", () => {
		for (const content of [...currencyDrafts, advisoryDraft, linkDraft]) {
			expect(CreatePisoCampContentInputSchema.parse(createInput(content))).toEqual(
				createInput(content)
			)
		}
	})

	it("exports the exact content type and lifecycle vocabularies", () => {
		expect([...CONTENT_TYPES]).toEqual(["banknote", "coin", "security_feature", "advisory", "link"])
		expect([...CONTENT_STATUSES]).toEqual([
			"draft",
			"submitted_for_review",
			"approved",
			"published",
			"unpublished",
			"deactivated",
			"archived",
		])
		expect(CONTENT_TYPES.map(value => PisoCampContentTypeSchema.parse(value))).toEqual(
			CONTENT_TYPES
		)
		expect(CONTENT_STATUSES.map(value => PisoCampContentStatusSchema.parse(value))).toEqual(
			CONTENT_STATUSES
		)
		expect(() => PisoCampContentStatusSchema.parse("submitted")).toThrow()
	})

	it.each(currencyDrafts)("requires series and denomination for $contentType", currencyDraft => {
		const withoutSeries = { ...currencyDraft, seriesCode: undefined }
		const withoutDenomination = { ...currencyDraft, denominationCode: undefined }

		expect(() => CreatePisoCampContentInputSchema.parse(createInput(withoutSeries))).toThrow()
		expect(() => CreatePisoCampContentInputSchema.parse(createInput(withoutDenomination))).toThrow()
	})

	it.each([advisoryDraft, linkDraft])("forbids currency fields on $contentType", content => {
		expect(() =>
			CreatePisoCampContentInputSchema.parse(
				createInput({ ...content, seriesCode: "ngc-banknotes", denominationCode: "php-20" })
			)
		).toThrow()
	})

	it("allows only banknote series on banknotes and coin series on coins", () => {
		expect(() =>
			PisoCampContentDraftSchema.parse({ ...currencyDrafts[0], seriesCode: "ngc-coins" })
		).toThrow()
		expect(() =>
			PisoCampContentDraftSchema.parse({ ...currencyDrafts[1], seriesCode: "ngc-banknotes" })
		).toThrow()
	})

	it("requires an HTTPS primary URL for link content", () => {
		for (const primaryUrl of ["http://www.bsp.gov.ph", "ftp://www.bsp.gov.ph", "/pisocamp"])
			expect(() => PisoCampContentDraftSchema.parse({ ...linkDraft, primaryUrl })).toThrow()
	})

	it("accepts a supplied blank link body after trimming", () => {
		expect(PisoCampContentDraftSchema.parse({ ...linkDraft, body: "   " })).toEqual({
			...linkDraft,
			body: "",
		})
	})

	it("reports malformed URLs as validation errors instead of throwing", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({ ...linkDraft, primaryUrl: "/pisocamp" }).success
		).toBe(false)
	})

	it.each([
		["blank title", { ...advisoryDraft, title: "   " }],
		["overlong title", { ...advisoryDraft, title: "t".repeat(161) }],
		["blank summary", { ...advisoryDraft, summary: "   " }],
		["overlong summary", { ...advisoryDraft, summary: "s".repeat(501) }],
		["blank body", { ...advisoryDraft, body: "   " }],
		["overlong body", { ...advisoryDraft, body: "b".repeat(10_001) }],
		["HTML body", { ...advisoryDraft, body: "<strong>Not plain text</strong>" }],
		["HTML comment body", { ...advisoryDraft, body: "<!-- Not plain text -->" }],
	] as const)("rejects %s", (_label, content) => {
		expect(() => PisoCampContentDraftSchema.parse(content)).toThrow()
	})

	it("trims bounded plain-text fields", () => {
		expect(
			PisoCampContentDraftSchema.parse({
				...advisoryDraft,
				title: "  Proper currency handling  ",
				summary: "  Handle currency with care.  ",
				body: "  Approved plain-text advisory.  ",
			})
		).toEqual(advisoryDraft)
	})

	it("accepts exactly the three strict related-link variants", () => {
		for (const link of relatedLinks) {
			expect(PisoCampRelatedLinkInputSchema.parse(link)).toEqual(link)
		}
	})

	it("rejects malformed or contradictory related links", () => {
		for (const link of [
			{ kind: "external", label: "Insecure", url: "http://example.com" },
			{ kind: "external", label: "   ", url: "https://example.com" },
			{ kind: "internal", label: "Not absolute", route: "pisocamp/currency" },
			{ kind: "internal", label: "Query", route: "/pisocamp/currency?draft=1" },
			{ kind: "topic", label: "Bad UUID", targetContentItemId: "not-a-uuid" },
			{ kind: "external", label: "x".repeat(101), url: "https://example.com" },
			{
				kind: "external",
				label: "Contradictory",
				url: "https://example.com",
				route: "/pisocamp",
			},
		]) {
			expect(() => PisoCampRelatedLinkInputSchema.parse(link)).toThrow()
		}
	})

	it("allows at most ten related links", () => {
		expect(
			CreatePisoCampContentInputSchema.safeParse(
				createInput(
					advisoryDraft,
					Array.from({ length: 11 }, () => relatedLinks[0])
				)
			).success
		).toBe(false)
	})

	it("rejects a self-referencing topic link on update", () => {
		expect(() =>
			UpdatePisoCampContentInputSchema.parse({
				itemId,
				requestId,
				expectedVersionNo: 1,
				content: advisoryDraft,
				relatedLinks: [{ kind: "topic", label: "Self", targetContentItemId: itemId }],
			})
		).toThrow()
	})

	it.each([
		"status",
		"actorId",
		"accountId",
		"editorId",
		"versionId",
		"publicationState",
		"auditBody",
		"auditEventBody",
	])("rejects client-owned field %s", field => {
		expect(() =>
			CreatePisoCampContentInputSchema.parse({ ...createInput(), [field]: "spoofed" })
		).toThrow()
	})

	it("rejects unknown keys at nested boundaries", () => {
		expect(() =>
			CreatePisoCampContentInputSchema.parse({
				...createInput({ ...advisoryDraft, unknown: true }),
			})
		).toThrow()
		expect(() =>
			CreatePisoCampContentInputSchema.parse(
				createInput(advisoryDraft, [{ ...relatedLinks[0], unknown: true }])
			)
		).toThrow()
	})
})

describe("CM-1 list and output schemas", () => {
	it("defaults and validates strict list filters", () => {
		expect(ListPisoCampContentInputSchema.parse({})).toEqual({ page: 1, limit: 20 })
		expect(
			ListPisoCampContentInputSchema.parse({
				page: 2,
				limit: 100,
				contentType: "banknote",
				status: "draft",
				seriesCode: "ngc-banknotes",
				denominationCode: "php-20",
				search: "  security feature  ",
			})
		).toEqual({
			page: 2,
			limit: 100,
			contentType: "banknote",
			status: "draft",
			seriesCode: "ngc-banknotes",
			denominationCode: "php-20",
			search: "security feature",
		})
		for (const input of [
			{ page: 0 },
			{ page: 1.5 },
			{ limit: 0 },
			{ limit: 101 },
			{ search: "   " },
			{ unknown: true },
		]) {
			expect(() => ListPisoCampContentInputSchema.parse(input)).toThrow()
		}
	})

	it("rejects HTML search strings", () => {
		expect(() => ListPisoCampContentInputSchema.parse({ search: "<!-- markup -->" })).toThrow()
	})

	const summary = {
		id: itemId,
		contentType: "banknote",
		status: "draft",
		title: currencyDrafts[0].title,
		seriesCode: "ngc-banknotes",
		denominationCode: "php-20",
		currentVersionNo: 1,
		creator: editor,
		lastEditor: editor,
		createdAt: timestamp,
		dateModified: timestamp,
	} as const

	it("parses strict summaries and paginated list output", () => {
		expect(PisoCampContentSummarySchema.parse(summary)).toEqual(summary)
		expect(
			ListPisoCampContentOutputSchema.parse({ items: [summary], page: 1, limit: 20, total: 1 })
		).toEqual({ items: [summary], page: 1, limit: 20, total: 1 })
		expect(() =>
			PisoCampContentSummarySchema.parse({ ...summary, body: "must not leak" })
		).toThrow()
	})

	it("rejects contradictory summary fields and non-UTC timestamps", () => {
		expect(() =>
			PisoCampContentSummarySchema.parse({
				...summary,
				contentType: "advisory",
			})
		).toThrow()
		expect(() =>
			PisoCampContentSummarySchema.parse({
				...summary,
				createdAt: "2026-08-25T10:03:04.000+08:00",
			})
		).toThrow()
	})

	const detail = {
		id: itemId,
		contentType: "banknote",
		status: "draft",
		currentVersion: {
			id: versionId,
			versionNo: 1,
			status: "draft",
			content: currencyDrafts[0],
			relatedLinks: [
				{
					id: "744485c4-0cd5-4d73-9e30-d0b256327b00",
					position: 0,
					...relatedLinks[0],
				},
			],
		},
		creator: editor,
		lastEditor: editor,
		createdAt: timestamp,
		dateModified: timestamp,
	} as const

	it("parses detail with its current version and immutable links", () => {
		expect(PisoCampContentDetailSchema.parse(detail)).toEqual(detail)
	})

	it("exports inferred public detail output types", () => {
		const currentVersion: PisoCampContentVersion =
			PisoCampContentDetailSchema.parse(detail).currentVersion
		const relatedLink: PisoCampRelatedLinkOutput | undefined = currentVersion.relatedLinks[0]

		expect(relatedLink?.kind).toBe("external")
	})

	it.each([
		{
			label: "item type differs from current content",
			value: { ...detail, contentType: "coin" },
		},
		{
			label: "item status differs from current version",
			value: { ...detail, status: "approved" },
		},
		{
			label: "current version has an unknown publication field",
			value: {
				...detail,
				currentVersion: { ...detail.currentVersion, currentPublished: true },
			},
		},
	])("rejects contradictory detail output: $label", ({ value }) => {
		expect(PisoCampContentDetailSchema.safeParse(value).success).toBe(false)
	})

	it("parses a strict controlled-currency catalog output", () => {
		const catalog = {
			version: "CM1-2026-08-25",
			series: [
				{
					code: "ngc-banknotes",
					name: "New Generation Currency Banknotes",
					mediaKind: "banknote",
					sourceUrl:
						"https://www.bsp.gov.ph/Pages/CoinsAndNotes/NewGenerationCurrencyBanknotes.aspx",
					catalogVersion: "CM1-2026-08-25",
					denominations: [{ code: "php-20", label: "PHP 20", minorUnitValue: 2000, sortOrder: 1 }],
				},
			],
		} as const

		expect(PisoCampCurrencyCatalogSchema.parse(catalog)).toEqual(catalog)
		expect(() =>
			PisoCampCurrencyCatalogSchema.parse({
				...catalog,
				series: [{ ...catalog.series[0], sourceUrl: "http://www.bsp.gov.ph" }],
			})
		).toThrow()
	})
})
