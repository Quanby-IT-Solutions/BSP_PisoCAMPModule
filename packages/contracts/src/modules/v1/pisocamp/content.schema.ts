import { z } from "zod"

export const CONTENT_TYPES = [
	"banknote",
	"coin",
	"security_feature",
	"advisory",
	"link",
	"trivia_question",
] as const
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

/**
 * BR-012. First-level features are the ones the public may be taught to check
 * unaided. Second-level features are for trained examiners, so they are kept out
 * of the offline bundle entirely rather than merely hidden by a client.
 */
export const CONTENT_FEATURE_LEVELS = ["first", "second"] as const
export const PisoCampFeatureLevelSchema = z.enum(CONTENT_FEATURE_LEVELS)

/**
 * Where a feature sits on its denomination's image, in permille of the image's
 * width and height, so the anchor survives any rendered size.
 */
export const PisoCampFeatureHotspotSchema = z
	.object({
		x: z.number().int().min(0).max(1000),
		y: z.number().int().min(0).max(1000),
	})
	.strict()

const HTML_MARKUP_PATTERN = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>|<\?[\s\S]*?\?>/

const UtcTimestampSchema = z.iso
	.datetime()
	.refine(value => value.endsWith("Z"), "Timestamp must be serialized in UTC")

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
		featureLevel: PisoCampFeatureLevelSchema,
		hotspot: PisoCampFeatureHotspotSchema.nullish(),
	})
	.strict()
	.refine(
		content => content.featureLevel === "first" || !content.hotspot,
		// A second-level feature never reaches a device, so a hotspot for one
		// would be an anchor to something the map does not show.
		{ message: "Only a first-level feature can carry a hotspot", path: ["hotspot"] }
	)

export const TRIVIA_DIFFICULTIES = ["easy", "medium", "hard"] as const
export const PisoCampTriviaDifficultySchema = z.enum(TRIVIA_DIFFICULTIES)

const TriviaChoiceSchema = z
	.object({
		label: z.string().trim().min(1).max(200).refine(value => !HTML_MARKUP_PATTERN.test(value), {
			message: "A choice must be plain text",
		}),
		correct: z.boolean(),
	})
	.strict()

/**
 * GM-1 trivia question.
 *
 * The question text is the item's title and the explanation is its body, so the
 * workflow already versions, diffs and audits both without knowing what a
 * question is.
 */
const TriviaQuestionDraftSchema = z
	.object({
		contentType: z.literal("trivia_question"),
		title: TitleSchema,
		summary: SummarySchema,
		body: BodySchema,
		category: CatalogCodeSchema,
		difficulty: PisoCampTriviaDifficultySchema,
		choices: z.array(TriviaChoiceSchema).min(2).max(6),
		// Required rather than defaulted: the input and output types then agree,
		// and an editor toggling a question off is an explicit act.
		active: z.boolean(),
	})
	.strict()
	.superRefine((question, context) => {
		const correct = question.choices.filter(choice => choice.correct)
		if (correct.length !== 1) {
			context.addIssue({
				code: "custom",
				message: "Exactly one choice must be correct",
				path: ["choices"],
			})
		}
		const labels = new Set(question.choices.map(choice => choice.label))
		if (labels.size !== question.choices.length) {
			context.addIssue({
				code: "custom",
				message: "Choices must be distinct",
				path: ["choices"],
			})
		}
	})

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
	TriviaQuestionDraftSchema,
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

export const PISO_CAMP_CONTENT_WORKFLOW_ACTIONS = [
	"submit",
	"approve",
	"reject",
	"publish",
	"unpublish",
	"deactivate",
	"archive",
] as const
export const PisoCampContentWorkflowActionSchema = z.enum(PISO_CAMP_CONTENT_WORKFLOW_ACTIONS)

const WorkflowCommentsSchema = z
	.string()
	.min(1)
	.max(2_000)
	.refine(value => value === value.trim(), "Comments must not have leading or trailing whitespace")
	.refine(value => !HTML_MARKUP_PATTERN.test(value), "HTML is not allowed")

const ContentTransitionCorrelationShape = {
	itemId: z.uuid(),
	requestId: z.uuid(),
	expectedVersionNo: z.number().int().positive(),
}

export const SubmitPisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema.optional() })
	.strict()

export const ApprovePisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema })
	.strict()

export const RejectPisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema })
	.strict()

export const PublishPisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema.optional() })
	.strict()

/**
 * CM-6 withdrawal transitions.
 *
 * Comments are optional, as on publish: the action itself is the record, and
 * requiring prose on an emergency withdrawal would slow the one transition
 * that most needs to be fast.
 */
export const UnpublishPisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema.optional() })
	.strict()

export const DeactivatePisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema.optional() })
	.strict()

export const ArchivePisoCampContentInputSchema = z
	.object({ ...ContentTransitionCorrelationShape, comments: WorkflowCommentsSchema.optional() })
	.strict()

/**
 * CM-6 scheduled publication.
 *
 * `publishAt: null` clears a schedule. A future instant is required when one is
 * set: a past instant would be an immediate publish wearing a schedule's
 * clothes, which hides the actor behind the scheduler.
 */
export const SchedulePisoCampContentPublicationInputSchema = z
	.object({
		itemId: z.uuid(),
		requestId: z.uuid(),
		expectedVersionNo: z.number().int().positive(),
		publishAt: UtcTimestampSchema.nullable(),
	})
	.strict()

export const ListPisoCampContentInputSchema = z
	.object({
		page: z.coerce.number().int().positive().default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
		contentType: PisoCampContentTypeSchema.optional(),
		status: PisoCampContentStatusSchema.optional(),
		seriesCode: PisoCampCurrencySeriesCodeSchema.optional(),
		denominationCode: DenominationCodeSchema.optional(),
		// GM-1: a question pool is browsed by what a question is about and how
		// hard it is, not by series and denomination.
		category: CatalogCodeSchema.optional(),
		difficulty: PisoCampTriviaDifficultySchema.optional(),
		search: PlainTextSchema(160).optional(),
	})
	.strict()

const EditorIdentitySchema = z
	.object({ id: z.string().min(1).max(255), name: PlainTextSchema(200) })
	.strict()

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
	z
		.object({
			...SummaryCommonShape,
			contentType: z.literal("trivia_question"),
			category: CatalogCodeSchema,
			difficulty: PisoCampTriviaDifficultySchema,
			active: z.boolean(),
		})
		.strict(),
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

const PisoCampContentTransitionMetadataSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("submit"), comments: WorkflowCommentsSchema.nullable() }).strict(),
	z.object({ action: z.literal("approve"), comments: WorkflowCommentsSchema }).strict(),
	z.object({ action: z.literal("reject"), comments: WorkflowCommentsSchema }).strict(),
	z.object({ action: z.literal("publish"), comments: WorkflowCommentsSchema.nullable() }).strict(),
	z
		.object({ action: z.literal("unpublish"), comments: WorkflowCommentsSchema.nullable() })
		.strict(),
	z
		.object({ action: z.literal("deactivate"), comments: WorkflowCommentsSchema.nullable() })
		.strict(),
	z.object({ action: z.literal("archive"), comments: WorkflowCommentsSchema.nullable() }).strict(),
])

const PisoCampContentActorTimestampSchema = z
	.object({ actor: EditorIdentitySchema, at: UtcTimestampSchema })
	.strict()

export const PisoCampContentReviewVersionSchema = PisoCampContentVersionSchema.extend({
	createdBy: EditorIdentitySchema,
	createdAt: UtcTimestampSchema,
	transition: PisoCampContentTransitionMetadataSchema,
	approval: PisoCampContentActorTimestampSchema.nullable(),
	publication: PisoCampContentActorTimestampSchema.nullable(),
})
	.strict()
	.superRefine((version, context) => {
		const expectedStatus = {
			submit: "submitted_for_review",
			approve: "approved",
			reject: "draft",
			publish: "published",
			unpublish: "unpublished",
			deactivate: "deactivated",
			archive: "archived",
		} as const

		if (version.status !== expectedStatus[version.transition.action]) {
			context.addIssue({
				code: "custom",
				message: "Transition action and version status must match",
				path: ["transition", "action"],
			})
		}

		const requiresApproval = version.status !== "draft" && version.status !== "submitted_for_review"
		if (requiresApproval !== (version.approval !== null)) {
			context.addIssue({
				code: "custom",
				message: "Approval metadata must match the version status",
				path: ["approval"],
			})
		}

		const requiresPublication = ["published", "unpublished", "deactivated", "archived"].includes(
			version.status
		)
		if (requiresPublication !== (version.publication !== null)) {
			context.addIssue({
				code: "custom",
				message: "Publication metadata must match the version status",
				path: ["publication"],
			})
		}
	})

export const PisoCampContentReviewDetailSchema = z
	.object({
		id: z.uuid(),
		contentType: PisoCampContentTypeSchema,
		status: PisoCampContentStatusSchema,
		/** CM-6: the scheduled publication instant, when one is set. */
		publishAt: UtcTimestampSchema.nullable(),
		currentVersion: PisoCampContentReviewVersionSchema,
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
		if (detail.publishAt !== null && detail.status !== "approved") {
			context.addIssue({
				code: "custom",
				message: "Only approved content can carry a scheduled publication",
				path: ["publishAt"],
			})
		}
	})

export const PISO_CAMP_CONTENT_REVIEW_QUEUE_STATUSES = ["submitted_for_review", "approved"] as const
export const PisoCampContentReviewQueueStatusSchema = z.enum(
	PISO_CAMP_CONTENT_REVIEW_QUEUE_STATUSES
)

export const ListPisoCampContentReviewQueueInputSchema = z
	.object({
		page: z.coerce.number().int().positive().default(1),
		limit: z.coerce.number().int().min(1).max(100).default(20),
		status: PisoCampContentReviewQueueStatusSchema.optional(),
	})
	.strict()

export const PisoCampContentReviewQueueSummarySchema = PisoCampContentSummarySchema.refine(
	(
		summary
	): summary is typeof summary & {
		status: (typeof PISO_CAMP_CONTENT_REVIEW_QUEUE_STATUSES)[number]
	} => PisoCampContentReviewQueueStatusSchema.safeParse(summary.status).success,
	"Only submitted or approved content belongs in the review queue"
)

export const ListPisoCampContentReviewQueueOutputSchema = z
	.object({
		items: z.array(PisoCampContentReviewQueueSummarySchema),
		page: z.number().int().positive(),
		limit: z.number().int().min(1).max(100),
		total: z.number().int().nonnegative(),
	})
	.strict()

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
export type PisoCampContentWorkflowAction = z.infer<typeof PisoCampContentWorkflowActionSchema>
export type SubmitPisoCampContentInput = z.infer<typeof SubmitPisoCampContentInputSchema>
export type ApprovePisoCampContentInput = z.infer<typeof ApprovePisoCampContentInputSchema>
export type RejectPisoCampContentInput = z.infer<typeof RejectPisoCampContentInputSchema>
export type PublishPisoCampContentInput = z.infer<typeof PublishPisoCampContentInputSchema>
export type ListPisoCampContentInput = z.infer<typeof ListPisoCampContentInputSchema>
export type PisoCampContentSummary = z.infer<typeof PisoCampContentSummarySchema>
export type PisoCampContentVersion = z.infer<typeof PisoCampContentVersionSchema>
export type PisoCampContentDetail = z.infer<typeof PisoCampContentDetailSchema>
export type PisoCampContentReviewVersion = z.infer<typeof PisoCampContentReviewVersionSchema>
export type PisoCampContentReviewDetail = z.infer<typeof PisoCampContentReviewDetailSchema>
export type PisoCampContentReviewQueueStatus = z.infer<
	typeof PisoCampContentReviewQueueStatusSchema
>
export type ListPisoCampContentReviewQueueInput = z.infer<
	typeof ListPisoCampContentReviewQueueInputSchema
>
export type PisoCampContentReviewQueueSummary = z.infer<
	typeof PisoCampContentReviewQueueSummarySchema
>
export type ListPisoCampContentReviewQueueOutput = z.infer<
	typeof ListPisoCampContentReviewQueueOutputSchema
>
export type ListPisoCampContentOutput = z.infer<typeof ListPisoCampContentOutputSchema>
export type PisoCampCurrencyCatalog = z.infer<typeof PisoCampCurrencyCatalogSchema>

export type UnpublishPisoCampContentInput = z.infer<typeof UnpublishPisoCampContentInputSchema>
export type DeactivatePisoCampContentInput = z.infer<typeof DeactivatePisoCampContentInputSchema>
export type ArchivePisoCampContentInput = z.infer<typeof ArchivePisoCampContentInputSchema>
export type SchedulePisoCampContentPublicationInput = z.infer<
	typeof SchedulePisoCampContentPublicationInputSchema
>
