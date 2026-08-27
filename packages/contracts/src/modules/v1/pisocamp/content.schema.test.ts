import { describe, expect, it } from "vitest"

import {
	ApprovePisoCampContentInputSchema,
	ListPisoCampContentReviewQueueInputSchema,
	ListPisoCampContentReviewQueueOutputSchema,
	PisoCampContentReviewDetailSchema,
	PublishPisoCampContentInputSchema,
	RejectPisoCampContentInputSchema,
	SubmitPisoCampContentInputSchema,
	type PisoCampContentReviewDetail,
	type PisoCampContentVersion,
	type PisoCampRelatedLinkOutput,
} from "../../../contracts.js"
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

describe("CM-3 workflow schemas", () => {
	const baseTransition = { itemId, requestId, expectedVersionNo: 2 }
	const approvedReviewDetail = {
		id: itemId,
		contentType: "banknote",
		status: "approved",
		currentVersion: {
			id: versionId,
			versionNo: 3,
			status: "approved",
			content: currencyDrafts[0],
			relatedLinks: [],
			createdBy: editor,
			createdAt: timestamp,
			transition: { action: "approve", comments: "Reviewed against BSP copy." },
			approval: { actor: editor, at: timestamp },
			publication: null,
		},
		creator: editor,
		lastEditor: editor,
		createdAt: timestamp,
		dateModified: timestamp,
	} as const

	it("requires strict UUID and optimistic-version correlation fields on every transition", () => {
		for (const { schema, input } of [
			{ schema: SubmitPisoCampContentInputSchema, input: baseTransition },
			{
				schema: ApprovePisoCampContentInputSchema,
				input: { ...baseTransition, comments: "Reviewed against BSP copy." },
			},
			{
				schema: RejectPisoCampContentInputSchema,
				input: { ...baseTransition, comments: "Reviewed against BSP copy." },
			},
			{ schema: PublishPisoCampContentInputSchema, input: baseTransition },
		]) {
			expect(schema.parse(input)).toEqual(input)
			expect(schema.safeParse({ ...input, itemId: "not-a-uuid" }).success).toBe(false)
			expect(schema.safeParse({ ...input, requestId: "not-a-uuid" }).success).toBe(false)
			expect(schema.safeParse({ ...input, expectedVersionNo: 0 }).success).toBe(false)
			expect(schema.safeParse({ ...input, unexpected: true }).success).toBe(false)
		}
	})

	it("requires review comments for approve and reject but keeps submit and publish comments optional", () => {
		for (const schema of [ApprovePisoCampContentInputSchema, RejectPisoCampContentInputSchema]) {
			expect(schema.safeParse(baseTransition).success).toBe(false)
			expect(schema.parse({ ...baseTransition, comments: "Reviewed against BSP copy." })).toEqual({
				...baseTransition,
				comments: "Reviewed against BSP copy.",
			})
		}

		for (const schema of [SubmitPisoCampContentInputSchema, PublishPisoCampContentInputSchema]) {
			expect(schema.parse(baseTransition)).toEqual(baseTransition)
		}
	})

	it("accepts trimmed plain-text comments up to 2000 characters and rejects markup or padding", () => {
		expect(
			ApprovePisoCampContentInputSchema.safeParse({
				...baseTransition,
				comments: "x".repeat(2000),
			}).success
		).toBe(true)
		for (const comments of [" padded", "padded ", "<b>approved</b>", "", "x".repeat(2001)]) {
			expect(
				ApprovePisoCampContentInputSchema.safeParse({ ...baseTransition, comments }).success
			).toBe(false)
		}
	})

	it("exports and parses strict immutable workflow metadata through the package entrypoint", () => {
		const parsedReviewDetail: PisoCampContentReviewDetail =
			PisoCampContentReviewDetailSchema.parse(approvedReviewDetail)

		expect(parsedReviewDetail).toEqual(approvedReviewDetail)
		expect(
			PisoCampContentReviewDetailSchema.safeParse({
				...approvedReviewDetail,
				currentVersion: {
					...approvedReviewDetail.currentVersion,
					undisclosedMutableFlag: true,
				},
			}).success
		).toBe(false)
	})

	it("rejects action/status mismatches and inconsistent approval/publication metadata", () => {
		const actionStatusMismatch = {
			...approvedReviewDetail,
			currentVersion: {
				...approvedReviewDetail.currentVersion,
				transition: { action: "submit", comments: null },
			},
		}
		const { approval, ...currentVersionWithoutApproval } = approvedReviewDetail.currentVersion
		const submittedWithUnexpectedApproval = {
			...approvedReviewDetail,
			status: "submitted_for_review",
			currentVersion: {
				...approvedReviewDetail.currentVersion,
				status: "submitted_for_review",
				transition: { action: "submit", comments: null },
				publication: null,
			},
		}
		const approvedWithUnexpectedPublication = {
			...approvedReviewDetail,
			currentVersion: {
				...approvedReviewDetail.currentVersion,
				publication: { actor: editor, at: timestamp },
			},
		}

		expect(approval).toBeDefined()
		for (const value of [
			actionStatusMismatch,
			{ ...approvedReviewDetail, currentVersion: currentVersionWithoutApproval },
			submittedWithUnexpectedApproval,
			approvedWithUnexpectedPublication,
		]) {
			expect(PisoCampContentReviewDetailSchema.safeParse(value).success).toBe(false)
		}
	})

	it("rejects null comments for approve and reject transition metadata", () => {
		const approveWithNullComments = {
			...approvedReviewDetail,
			currentVersion: {
				...approvedReviewDetail.currentVersion,
				transition: { action: "approve", comments: null },
			},
		}
		const rejectWithNullComments = {
			...approvedReviewDetail,
			status: "draft",
			currentVersion: {
				...approvedReviewDetail.currentVersion,
				status: "draft",
				transition: { action: "reject", comments: null },
				approval: null,
				publication: null,
			},
		}

		expect(PisoCampContentReviewDetailSchema.safeParse(approveWithNullComments).success).toBe(false)
		expect(PisoCampContentReviewDetailSchema.safeParse(rejectWithNullComments).success).toBe(false)
	})

	it("coerces bounded review-queue pagination and rejects non-review statuses", () => {
		const summary = {
			id: itemId,
			contentType: "banknote",
			status: "submitted_for_review",
			title: currencyDrafts[0].title,
			seriesCode: "ngc-banknotes",
			denominationCode: "php-20",
			currentVersionNo: 2,
			creator: editor,
			lastEditor: editor,
			createdAt: timestamp,
			dateModified: timestamp,
		} as const

		expect(
			ListPisoCampContentReviewQueueInputSchema.parse({
				page: "2",
				limit: "20",
				status: "approved",
			})
		).toEqual({
			page: 2,
			limit: 20,
			status: "approved",
		})
		expect(
			ListPisoCampContentReviewQueueInputSchema.safeParse({ page: 0, limit: 101 }).success
		).toBe(false)
		expect(ListPisoCampContentReviewQueueInputSchema.safeParse({ status: "draft" }).success).toBe(
			false
		)
		expect(
			ListPisoCampContentReviewQueueOutputSchema.parse({
				items: [summary],
				page: 1,
				limit: 20,
				total: 1,
			})
		).toEqual({
			items: [summary],
			page: 1,
			limit: 20,
			total: 1,
		})
		expect(
			ListPisoCampContentReviewQueueOutputSchema.safeParse({
				items: [{ ...summary, status: "draft" }],
				page: 1,
				limit: 20,
				total: 1,
			}).success
		).toBe(false)
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
