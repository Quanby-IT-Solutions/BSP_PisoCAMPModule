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
	CONTENT_FEATURE_LEVELS,
	CONTENT_STATUSES,
	CONTENT_TYPES,
	NPS_BANDS,
	npsBandFor,
	SURVEY_PURPOSES,
	SURVEY_QUESTION_KINDS,
	SURVEY_SCALES,
	TRIVIA_DIFFICULTIES,
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
		featureLevel: "first",
		hotspot: { x: 420, y: 615 },
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
		expect([...CONTENT_TYPES]).toEqual([
			"banknote",
			"coin",
			"security_feature",
			"advisory",
			"link",
			"trivia_question",
			"survey",
		])
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
		publishAt: null,
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

describe("CE-3 security feature disclosure level", () => {
	const feature = {
		contentType: "security_feature",
		title: "Security thread",
		summary: "A denomination-specific security feature",
		body: "Approved plain-text description.",
		seriesCode: "engc-banknotes",
		denominationCode: "php-100",
	} as const

	it("exports the exact disclosure vocabulary", () => {
		expect([...CONTENT_FEATURE_LEVELS]).toEqual(["first", "second"])
	})

	it("requires a level on a security feature and refuses one anywhere else", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({ ...feature, featureLevel: "second" }).success
		).toBe(true)
		// A feature with no stated level cannot be classified, so it cannot be
		// kept out of the bundle either.
		expect(PisoCampContentDraftSchema.safeParse(feature).success).toBe(false)
		expect(
			PisoCampContentDraftSchema.safeParse({
				contentType: "advisory",
				title: "Advisory",
				summary: "An advisory",
				body: "Body copy.",
				featureLevel: "first",
			}).success
		).toBe(false)
		expect(
			PisoCampContentDraftSchema.safeParse({ ...feature, featureLevel: "third" }).success
		).toBe(false)
	})

	it("treats an absent hotspot as absent rather than as a position", () => {
		const parsed = PisoCampContentDraftSchema.parse({ ...feature, featureLevel: "first" })

		expect(parsed).toMatchObject({ featureLevel: "first" })
		expect((parsed as { hotspot?: unknown }).hotspot ?? null).toBeNull()
		expect(
			PisoCampContentDraftSchema.safeParse({ ...feature, featureLevel: "first", hotspot: null })
				.success
		).toBe(true)
	})

	it("anchors a hotspot in permille and bounds it to the image", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({
				...feature,
				featureLevel: "first",
				hotspot: { x: 0, y: 1000 },
			}).success
		).toBe(true)
		for (const hotspot of [
			{ x: -1, y: 500 },
			{ x: 1001, y: 500 },
			{ x: 500, y: 1001 },
			{ x: 12.5, y: 500 },
			{ x: 500 },
			{ x: 500, y: 500, z: 500 },
		]) {
			expect(
				PisoCampContentDraftSchema.safeParse({ ...feature, featureLevel: "first", hotspot })
					.success,
				JSON.stringify(hotspot)
			).toBe(false)
		}
	})

	it("refuses a hotspot on a feature that will never reach a device", () => {
		const parsed = PisoCampContentDraftSchema.safeParse({
			...feature,
			featureLevel: "second",
			hotspot: { x: 400, y: 400 },
		})

		expect(parsed.success).toBe(false)
		expect(parsed.error?.issues.some(issue => issue.path.includes("hotspot"))).toBe(true)
	})
})

describe("GM-1 trivia questions", () => {
	const question = {
		contentType: "trivia_question",
		title: "Which feature is raised to the touch?",
		summary: "A question about what to check on a banknote.",
		body: "The embossed value is raised, so it can be felt with a fingertip.",
		category: "security-features",
		difficulty: "easy",
		choices: [
			{ label: "The embossed value", correct: true },
			{ label: "The serial number", correct: false },
		],
		active: true,
	} as const

	it("is a content type like any other", () => {
		expect([...CONTENT_TYPES]).toContain("trivia_question")
		expect([...TRIVIA_DIFFICULTIES]).toEqual(["easy", "medium", "hard"])
		expect(PisoCampContentDraftSchema.safeParse(question).success).toBe(true)
	})

	it("accepts two to six choices and nothing else", () => {
		const choices = (count: number) =>
			Array.from({ length: count }, (_, index) => ({
				label: `Choice ${index}`,
				correct: index === 0,
			}))

		for (const count of [2, 3, 4, 5, 6]) {
			expect(
				PisoCampContentDraftSchema.safeParse({ ...question, choices: choices(count) }).success,
				`${count} choices`
			).toBe(true)
		}
		for (const count of [0, 1, 7]) {
			expect(
				PisoCampContentDraftSchema.safeParse({ ...question, choices: choices(count) }).success,
				`${count} choices`
			).toBe(false)
		}
	})

	it("requires exactly one correct answer", () => {
		for (const choices of [
			[
				{ label: "A", correct: false },
				{ label: "B", correct: false },
			],
			[
				{ label: "A", correct: true },
				{ label: "B", correct: true },
			],
		]) {
			const parsed = PisoCampContentDraftSchema.safeParse({ ...question, choices })
			expect(parsed.success).toBe(false)
			expect(parsed.error?.issues.some(issue => issue.path.includes("choices"))).toBe(true)
		}
	})

	it("refuses repeated, empty or marked-up choices", () => {
		for (const choices of [
			[
				{ label: "Same", correct: true },
				{ label: "Same", correct: false },
			],
			[
				{ label: "", correct: true },
				{ label: "B", correct: false },
			],
			[
				{ label: "<b>A</b>", correct: true },
				{ label: "B", correct: false },
			],
		]) {
			expect(
				PisoCampContentDraftSchema.safeParse({ ...question, choices }).success,
				JSON.stringify(choices)
			).toBe(false)
		}
	})

	it("trims a padded label rather than refusing it", () => {
		// The contract normalises and the database's `btrim(label) = label`
		// check is the backstop, so the two cannot disagree about what is
		// stored.
		const parsed = PisoCampContentDraftSchema.parse({
			...question,
			choices: [
				{ label: "  The embossed value  ", correct: true },
				{ label: "The serial number", correct: false },
			],
		}) as { choices: { label: string }[] }

		expect(parsed.choices[0]?.label).toBe("The embossed value")
	})

	it("requires a catalog-shaped category and a known difficulty", () => {
		for (const override of [
			{ category: "Security Features" },
			{ category: "" },
			{ difficulty: "impossible" },
		]) {
			expect(
				PisoCampContentDraftSchema.safeParse({ ...question, ...override }).success,
				JSON.stringify(override)
			).toBe(false)
		}
	})

	it("makes the active flag explicit rather than assumed", () => {
		// Required, so an editor toggling a question off is a deliberate act and
		// the input and output shapes agree.
		const withoutActive = Object.fromEntries(
			Object.entries(question).filter(([key]) => key !== "active")
		)
		expect(PisoCampContentDraftSchema.safeParse(withoutActive).success).toBe(false)
		expect(
			PisoCampContentDraftSchema.safeParse({ ...question, active: false }).success
		).toBe(true)
	})

	it("refuses question fields on any other content type", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({
				contentType: "advisory",
				title: "Advisory",
				summary: "An advisory",
				body: "Body copy.",
				category: "security-features",
			}).success
		).toBe(false)
	})
})

describe("EV-1 surveys", () => {
	const rating = {
		kind: "rating",
		prompt: "How clear was this topic?",
		required: true,
		lowLabel: "Not clear at all",
		highLabel: "Very clear",
	} as const
	const nps = {
		kind: "nps",
		prompt: "How likely are you to recommend Piso CAMP?",
		required: true,
		lowLabel: "Not at all likely",
		highLabel: "Extremely likely",
	} as const
	const text = { kind: "text", prompt: "What would you change?", required: false } as const

	const survey = {
		contentType: "survey",
		title: "How did we do?",
		summary: "A short evaluation shown after a topic.",
		body: "Answering is optional and takes less than a minute.",
		purpose: "satisfaction",
		subjectContentItemId: null,
		questions: [rating, text],
	} as const

	it("is a content type like any other", () => {
		expect([...CONTENT_TYPES]).toContain("survey")
		expect([...SURVEY_PURPOSES]).toEqual([
			"topic",
			"satisfaction",
			"feature",
			"application",
			"nps",
			"usefulness",
		])
		expect([...SURVEY_QUESTION_KINDS]).toEqual(["rating", "nps", "text"])
		expect(PisoCampContentDraftSchema.safeParse(survey).success).toBe(true)
	})

	it("states the scales and the NPS grouping the SRD fixes", () => {
		expect(SURVEY_SCALES).toEqual({ rating: { min: 1, max: 5 }, nps: { min: 0, max: 10 } })
		expect(NPS_BANDS).toEqual({ promoterMin: 9, passiveMin: 7 })
		// Promoter 9-10, passive 7-8, detractor 0-6, at every boundary.
		expect([10, 9].map(npsBandFor)).toEqual(["promoter", "promoter"])
		expect([8, 7].map(npsBandFor)).toEqual(["passive", "passive"])
		expect([6, 0].map(npsBandFor)).toEqual(["detractor", "detractor"])
	})

	it("takes between one and twenty questions", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({ ...survey, questions: [] }).success
		).toBe(false)
		const many = Array.from({ length: 20 }, (_value, index) => ({
			...text,
			prompt: `Question ${index}`,
		}))
		expect(PisoCampContentDraftSchema.safeParse({ ...survey, questions: many }).success).toBe(true)
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [...many, { ...text, prompt: "One too many" }],
			}).success
		).toBe(false)
	})

	it("refuses a repeated prompt, which a response could not be attributed to", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({ ...survey, questions: [rating, rating] }).success
		).toBe(false)
	})

	it("requires an NPS survey to ask the NPS question, and only once", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({ ...survey, purpose: "nps", questions: [rating] })
				.success
		).toBe(false)
		expect(
			PisoCampContentDraftSchema.safeParse({ ...survey, purpose: "nps", questions: [nps] }).success
		).toBe(true)
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [nps, { ...nps, prompt: "And again?" }],
			}).success
		).toBe(false)
	})

	it("words both ends of a scale, and neither end of a text answer", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [{ kind: "rating", prompt: rating.prompt, required: true }],
			}).success
		).toBe(false)
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [{ ...text, lowLabel: "Low", highLabel: "High" }],
			}).success
		).toBe(false)
	})

	it("refuses a scale an editor tried to choose", () => {
		// The bounds belong to the kind: a rating that ran 1-7 on one survey and
		// 1-5 on another could not be reported together.
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [{ ...rating, scaleMin: 1, scaleMax: 7 }],
			}).success
		).toBe(false)
	})

	it("refuses markup in a prompt and an unknown question kind", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [{ ...text, prompt: "<b>Tell us</b>" }],
			}).success
		).toBe(false)
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				questions: [{ kind: "ranking", prompt: "Order these", required: false }],
			}).success
		).toBe(false)
	})

	it("takes an optional subject and refuses one that is not an id", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({
				...survey,
				subjectContentItemId: "3f3d4c0e-9f7c-4f3a-9d8e-8b2b0a1c5d61",
			}).success
		).toBe(true)
		const withoutSubject = Object.fromEntries(
			Object.entries(survey).filter(([key]) => key !== "subjectContentItemId")
		)
		expect(PisoCampContentDraftSchema.safeParse(withoutSubject).success).toBe(true)
		expect(
			PisoCampContentDraftSchema.safeParse({ ...survey, subjectContentItemId: "the topic" })
				.success
		).toBe(false)
	})

	it("refuses survey fields on any other content type", () => {
		expect(
			PisoCampContentDraftSchema.safeParse({
				contentType: "advisory",
				title: survey.title,
				summary: survey.summary,
				body: survey.body,
				purpose: "topic",
				questions: [text],
			}).success
		).toBe(false)
	})
})
