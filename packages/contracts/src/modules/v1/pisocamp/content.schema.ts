import { z } from "zod"

export const CONTENT_TYPES = ["banknote", "coin", "security_feature", "advisory", "link"] as const
export const PisoCampContentTypeSchema = z.enum(CONTENT_TYPES)

export const CONTENT_STATUSES = [
	"draft",
	"submitted_for_review",
	"approved",
	"published",
	"unpublished",
	"deactivated",
	"archived",
] as const
export const PisoCampContentStatusSchema = z.enum(CONTENT_STATUSES)

export const PISO_CAMP_CURRENCY_SERIES_CODES = [
	"fpp-banknotes",
	"engc-banknotes",
	"ngc-banknotes",
	"ngc-coins",
	"bsp-coin-series",
] as const
export const PisoCampCurrencySeriesCodeSchema = z.enum(PISO_CAMP_CURRENCY_SERIES_CODES)

const BanknoteSeriesCodeSchema = z.enum(["fpp-banknotes", "engc-banknotes", "ngc-banknotes"])
const CoinSeriesCodeSchema = z.enum(["ngc-coins", "bsp-coin-series"])
const CatalogCodeSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const DenominationCodeSchema = CatalogCodeSchema

const HTML_MARKUP_PATTERN = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>|<\?[\s\S]*?\?>/

const PlainTextSchema = (maximum: number, minimum = 1) =>
	z
		.string()
		.trim()
		.min(minimum)
		.max(maximum)
		.refine(value => !HTML_MARKUP_PATTERN.test(value), "HTML is not allowed")

const TitleSchema = PlainTextSchema(160)
const SummarySchema = PlainTextSchema(500)
const BodySchema = PlainTextSchema(10_000)
const OptionalLinkBodySchema = PlainTextSchema(10_000, 0)
const LinkLabelSchema = PlainTextSchema(100)

const isHttpsUrl = (value: string) => {
	try {
		return new URL(value).protocol === "https:"
	} catch {
		return false
	}
}

const HttpsUrlSchema = z
	.string()
	.trim()
	.min(1)
	.max(2_048)
	.url()
	.refine(isHttpsUrl, "HTTPS is required")

const InternalRouteSchema = z
	.string()
	.trim()
	.min(1)
	.max(512)
	.regex(
		/^\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)*$/,
		"Use an absolute lower-case application route"
	)

const BanknoteDraftSchema = z
	.object({
		contentType: z.literal("banknote"),
		title: TitleSchema,
		summary: SummarySchema,
		body: BodySchema,
		seriesCode: BanknoteSeriesCodeSchema,
		denominationCode: DenominationCodeSchema,
	})
	.strict()

const CoinDraftSchema = z
	.object({
		contentType: z.literal("coin"),
		title: TitleSchema,
		summary: SummarySchema,
		body: BodySchema,
		seriesCode: CoinSeriesCodeSchema,
		denominationCode: DenominationCodeSchema,
	})
	.strict()

const SecurityFeatureDraftSchema = z
	.object({
		contentType: z.literal("security_feature"),
		title: TitleSchema,
		summary: SummarySchema,
		body: BodySchema,
		seriesCode: PisoCampCurrencySeriesCodeSchema,
		denominationCode: DenominationCodeSchema,
	})
	.strict()

const AdvisoryDraftSchema = z
	.object({
		contentType: z.literal("advisory"),
		title: TitleSchema,
		summary: SummarySchema,
		body: BodySchema,
	})
	.strict()

const LinkDraftSchema = z
	.object({
		contentType: z.literal("link"),
		title: TitleSchema,
		summary: SummarySchema,
		body: OptionalLinkBodySchema.optional(),
		primaryUrl: HttpsUrlSchema,
	})
	.strict()

export const PisoCampContentDraftSchema = z.discriminatedUnion("contentType", [
	BanknoteDraftSchema,
	CoinDraftSchema,
	SecurityFeatureDraftSchema,
	AdvisoryDraftSchema,
	LinkDraftSchema,
])

const ExternalRelatedLinkInputSchema = z
	.object({ kind: z.literal("external"), label: LinkLabelSchema, url: HttpsUrlSchema })
	.strict()
const InternalRelatedLinkInputSchema = z
	.object({ kind: z.literal("internal"), label: LinkLabelSchema, route: InternalRouteSchema })
	.strict()
const TopicRelatedLinkInputSchema = z
	.object({
		kind: z.literal("topic"),
		label: LinkLabelSchema,
		targetContentItemId: z.uuid(),
	})
	.strict()

export const PisoCampRelatedLinkInputSchema = z.discriminatedUnion("kind", [
	ExternalRelatedLinkInputSchema,
	InternalRelatedLinkInputSchema,
	TopicRelatedLinkInputSchema,
])

const RelatedLinksInputSchema = z.array(PisoCampRelatedLinkInputSchema).max(10)

export const CreatePisoCampContentInputSchema = z
	.object({
		requestId: z.uuid(),
		content: PisoCampContentDraftSchema,
		relatedLinks: RelatedLinksInputSchema,
	})
	.strict()

export const UpdatePisoCampContentInputSchema = z
	.object({
		itemId: z.uuid(),
		requestId: z.uuid(),
		expectedVersionNo: z.number().int().positive(),
		content: PisoCampContentDraftSchema,
		relatedLinks: RelatedLinksInputSchema,
	})
	.strict()
	.superRefine((input, context) => {
		input.relatedLinks.forEach((link, index) => {
			if (link.kind === "topic" && link.targetContentItemId === input.itemId) {
				context.addIssue({
					code: "custom",
					message: "A content item cannot link to itself",
					path: ["relatedLinks", index, "targetContentItemId"],
				})
			}
		})
	})

export const PisoCampContentItemIdSchema = z.object({ itemId: z.uuid() }).strict()

export const ListPisoCampContentInputSchema = z
	.object({
		page: z.coerce.number().int().positive().default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
		contentType: PisoCampContentTypeSchema.optional(),
		status: PisoCampContentStatusSchema.optional(),
		seriesCode: PisoCampCurrencySeriesCodeSchema.optional(),
		denominationCode: DenominationCodeSchema.optional(),
		search: PlainTextSchema(160).optional(),
	})
	.strict()

const EditorIdentitySchema = z
	.object({ id: z.string().min(1).max(255), name: PlainTextSchema(200) })
	.strict()
const UtcTimestampSchema = z.iso
	.datetime()
	.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC")

const SummaryCommonShape = {
	id: z.uuid(),
	status: PisoCampContentStatusSchema,
	title: TitleSchema,
	currentVersionNo: z.number().int().positive(),
	creator: EditorIdentitySchema,
	lastEditor: EditorIdentitySchema,
	createdAt: UtcTimestampSchema,
	dateModified: UtcTimestampSchema,
}

const CurrencyContentSummarySchemas = [
	z
		.object({
			...SummaryCommonShape,
			contentType: z.literal("banknote"),
			seriesCode: BanknoteSeriesCodeSchema,
			denominationCode: DenominationCodeSchema,
		})
		.strict(),
	z
		.object({
			...SummaryCommonShape,
			contentType: z.literal("coin"),
			seriesCode: CoinSeriesCodeSchema,
			denominationCode: DenominationCodeSchema,
		})
		.strict(),
	z
		.object({
			...SummaryCommonShape,
			contentType: z.literal("security_feature"),
			seriesCode: PisoCampCurrencySeriesCodeSchema,
			denominationCode: DenominationCodeSchema,
		})
		.strict(),
] as const

export const PisoCampContentSummarySchema = z.discriminatedUnion("contentType", [
	...CurrencyContentSummarySchemas,
	z.object({ ...SummaryCommonShape, contentType: z.literal("advisory") }).strict(),
	z.object({ ...SummaryCommonShape, contentType: z.literal("link") }).strict(),
])

const RelatedLinkOutputBaseShape = { id: z.uuid(), position: z.number().int().nonnegative() }
export const PisoCampRelatedLinkOutputSchema = z.discriminatedUnion("kind", [
	z.object({ ...RelatedLinkOutputBaseShape, ...ExternalRelatedLinkInputSchema.shape }).strict(),
	z.object({ ...RelatedLinkOutputBaseShape, ...InternalRelatedLinkInputSchema.shape }).strict(),
	z.object({ ...RelatedLinkOutputBaseShape, ...TopicRelatedLinkInputSchema.shape }).strict(),
])

export const PisoCampContentVersionSchema = z
	.object({
		id: z.uuid(),
		versionNo: z.number().int().positive(),
		status: PisoCampContentStatusSchema,
		content: PisoCampContentDraftSchema,
		relatedLinks: z.array(PisoCampRelatedLinkOutputSchema).max(10),
	})
	.strict()

export const PisoCampContentDetailSchema = z
	.object({
		id: z.uuid(),
		contentType: PisoCampContentTypeSchema,
		status: PisoCampContentStatusSchema,
		currentVersion: PisoCampContentVersionSchema,
		creator: EditorIdentitySchema,
		lastEditor: EditorIdentitySchema,
		createdAt: UtcTimestampSchema,
		dateModified: UtcTimestampSchema,
	})
	.strict()
	.superRefine((detail, context) => {
		if (detail.contentType !== detail.currentVersion.content.contentType) {
			context.addIssue({
				code: "custom",
				message: "Item and current-version content types must match",
				path: ["currentVersion", "content", "contentType"],
			})
		}
		if (detail.status !== detail.currentVersion.status) {
			context.addIssue({
				code: "custom",
				message: "Item and current-version statuses must match",
				path: ["currentVersion", "status"],
			})
		}
	})

export const ListPisoCampContentOutputSchema = z
	.object({
		items: z.array(PisoCampContentSummarySchema),
		page: z.number().int().positive(),
		limit: z.number().int().min(1).max(100),
		total: z.number().int().nonnegative(),
	})
	.strict()

const PisoCampCurrencyDenominationSchema = z
	.object({
		code: DenominationCodeSchema,
		label: PlainTextSchema(100),
		minorUnitValue: z.number().int().positive(),
		sortOrder: z.number().int().nonnegative(),
	})
	.strict()

const expectedMediaKind = (seriesCode: (typeof PISO_CAMP_CURRENCY_SERIES_CODES)[number]) =>
	seriesCode.endsWith("banknotes") ? "banknote" : "coin"

const PisoCampCurrencySeriesSchema = z
	.object({
		code: PisoCampCurrencySeriesCodeSchema,
		name: PlainTextSchema(160),
		mediaKind: z.enum(["banknote", "coin"]),
		sourceUrl: HttpsUrlSchema,
		catalogVersion: z.string().trim().min(1).max(64),
		denominations: z.array(PisoCampCurrencyDenominationSchema).min(1),
	})
	.strict()
	.superRefine((series, context) => {
		if (series.mediaKind !== expectedMediaKind(series.code)) {
			context.addIssue({
				code: "custom",
				message: "Series code and media kind must match",
				path: ["mediaKind"],
			})
		}
		const codes = new Set<string>()
		series.denominations.forEach((denomination, index) => {
			if (codes.has(denomination.code)) {
				context.addIssue({
					code: "custom",
					message: "Denomination codes must be unique within a series",
					path: ["denominations", index, "code"],
				})
			}
			codes.add(denomination.code)
		})
	})

export const PisoCampCurrencyCatalogSchema = z
	.object({
		version: z.string().trim().min(1).max(64),
		series: z.array(PisoCampCurrencySeriesSchema),
	})
	.strict()
	.superRefine((catalog, context) => {
		const codes = new Set<string>()
		catalog.series.forEach((series, index) => {
			if (series.catalogVersion !== catalog.version) {
				context.addIssue({
					code: "custom",
					message: "Series catalog version must match the catalog",
					path: ["series", index, "catalogVersion"],
				})
			}
			if (codes.has(series.code)) {
				context.addIssue({
					code: "custom",
					message: "Series codes must be unique",
					path: ["series", index, "code"],
				})
			}
			codes.add(series.code)
		})
	})

export type PisoCampContentType = z.infer<typeof PisoCampContentTypeSchema>
export type PisoCampContentStatus = z.infer<typeof PisoCampContentStatusSchema>
export type PisoCampContentDraft = z.infer<typeof PisoCampContentDraftSchema>
export type PisoCampRelatedLinkInput = z.infer<typeof PisoCampRelatedLinkInputSchema>
export type PisoCampRelatedLinkOutput = z.infer<typeof PisoCampRelatedLinkOutputSchema>
export type CreatePisoCampContentInput = z.infer<typeof CreatePisoCampContentInputSchema>
export type UpdatePisoCampContentInput = z.infer<typeof UpdatePisoCampContentInputSchema>
export type ListPisoCampContentInput = z.infer<typeof ListPisoCampContentInputSchema>
export type PisoCampContentSummary = z.infer<typeof PisoCampContentSummarySchema>
export type PisoCampContentVersion = z.infer<typeof PisoCampContentVersionSchema>
export type PisoCampContentDetail = z.infer<typeof PisoCampContentDetailSchema>
export type ListPisoCampContentOutput = z.infer<typeof ListPisoCampContentOutputSchema>
export type PisoCampCurrencyCatalog = z.infer<typeof PisoCampCurrencyCatalogSchema>
