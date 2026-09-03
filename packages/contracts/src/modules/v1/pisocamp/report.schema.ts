import { z } from "zod"

import { AdoptionSummarySchema } from "./adoption.schema.js"
import { EngagementSummarySchema } from "./engagement.schema.js"
import { RetentionSummarySchema } from "./retention.schema.js"

const NonNegativeInt = z.number().int().nonnegative()

/**
 * How much activity there was, and what kind.
 *
 * The KPI added alongside the framework, so "a new KPI registers as a new
 * definition" is a claim this ticket actually demonstrates rather than one it
 * only describes.
 */
export const ActivitySummarySchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		totalEvents: NonNegativeInt,
		distinctUsers: NonNegativeInt,
		byEvent: z
			.array(
				z
					.object({
						eventName: z.string().min(1).max(64),
						events: NonNegativeInt,
						users: NonNegativeInt,
					})
					.strict()
			)
			.max(200),
		byDay: z
			.array(z.object({ date: z.iso.date(), events: NonNegativeInt }).strict())
			.max(366),
	})
	.strict()

export type ActivitySummary = z.infer<typeof ActivitySummarySchema>

/**
 * SA-4. The administrative trail, as a report so it exports like one.
 *
 * A second export mechanism for the audit log would be a second thing to get
 * right; this way the trail goes out through AN-9's renderers and the export
 * itself is audited by AN-9's own entry.
 */
export const AuditReportSchema = z
	.object({
		from: z.iso.date(),
		to: z.iso.date(),
		timezone: z.literal("Asia/Manila"),
		/** How many entries the file carries; a report has a bounded size. */
		entryCount: NonNegativeInt,
		truncated: z.boolean(),
		entries: z
			.array(
				z
					.object({
						id: z.number().int(),
						at: z.iso.datetime(),
						actor: z.string(),
						action: z.string(),
						outcome: z.string(),
						target: z.string(),
						before: z.string(),
						after: z.string(),
						reason: z.string(),
					})
					.strict()
			)
			.max(5000),
	})
	.strict()

export type AuditReport = z.infer<typeof AuditReportSchema>

/**
 * The filters §4.2-K approves.
 *
 * One list, so "the approved list" is a thing the code can be checked against
 * rather than a sentence in a document.
 */
export const REPORT_FILTER_KEYS = [
	"appVersion",
	"feature",
	"userType",
	"ageGroup",
	"gender",
	"region",
	"city",
	"device",
	"os",
	"activityType",
	// SA-4's filters on the administrative trail. §3.6 is the authority for
	// these, not §4.2-K's KPI list; they narrow the audit report and nothing
	// else, which is why only that definition declares them.
	"actor",
	"targetType",
	"surveyType",
	"contentTopic",
	"currencySeries",
	"denomination",
] as const
export const ReportFilterKeySchema = z.enum(REPORT_FILTER_KEYS)
export type ReportFilterKey = z.infer<typeof ReportFilterKeySchema>

/**
 * The filters that name something about a person rather than about a device.
 *
 * These need AN-10's consent scoping before they can return anything: a
 * demographic cut of people who never consented to demographic analytics is
 * exactly the report F4 exists to prevent.
 */
export const DEMOGRAPHIC_FILTER_KEYS = ["ageGroup", "gender", "region", "city"] as const

const Text = z.string().min(1).max(64)

export const ReportFiltersSchema = z
	.object({
		appVersion: Text.optional(),
		feature: Text.optional(),
		userType: z.enum(["guest", "registered"]).optional(),
		ageGroup: Text.optional(),
		gender: z.enum(["female", "male", "prefer_not_to_say"]).optional(),
		region: z.string().regex(/^\d{10}$/).optional(),
		city: z.string().regex(/^\d{10}$/).optional(),
		device: z.enum(["phone", "tablet"]).optional(),
		os: z.enum(["android", "ios"]).optional(),
		activityType: Text.optional(),
		actor: z.string().min(1).max(200).optional(),
		targetType: Text.optional(),
		surveyType: Text.optional(),
		contentTopic: Text.optional(),
		currencySeries: Text.optional(),
		denomination: Text.optional(),
	})
	.strict()

export type ReportFilters = z.infer<typeof ReportFiltersSchema>

/**
 * The report registry.
 *
 * A KPI is a row here plus its result shape below. Nothing in the running,
 * recording, auditing or listing of a report knows any definition by name, so
 * adding one is a declaration rather than a change to the framework.
 */
export const REPORT_DEFINITIONS = [
	{
		key: "engagement",
		name: "Engagement",
		description: "Sessions, active users, duration and screen views.",
		dataSource: "analytics_session",
		filters: [],
	},
	{
		key: "retention",
		name: "Retention",
		description: "Cohort retention, churn, lifetime, re-engagement and reactivation.",
		dataSource: "analytics_session",
		filters: [],
	},
	{
		key: "adoption",
		name: "Adoption",
		description: "Feature usage, account creation and time to first key action.",
		dataSource: "analytics_event",
		filters: ["appVersion", "feature", "userType", "device", "os"],
	},
	{
		key: "audit",
		name: "Administrative audit trail",
		description: "Who did what, when, and what it was before.",
		dataSource: "audit_log",
		filters: ["actor", "activityType", "targetType"],
	},
	{
		key: "activity",
		name: "Activity",
		description: "Event volume by name and by day.",
		dataSource: "analytics_event",
		filters: ["appVersion", "feature", "userType", "device", "os", "activityType"],
	},
] as const satisfies readonly {
	key: string
	name: string
	description: string
	dataSource: string
	filters: readonly ReportFilterKey[]
}[]

export type ReportDefinitionKey = (typeof REPORT_DEFINITIONS)[number]["key"]

/** Derived from the registry, so the two can never name different reports. */
export const ReportDefinitionKeySchema = z.enum(
	REPORT_DEFINITIONS.map(definition => definition.key) as unknown as [
		ReportDefinitionKey,
		...ReportDefinitionKey[],
	]
)

export const ReportDefinitionSchema = z
	.object({
		key: ReportDefinitionKeySchema,
		name: z.string().min(1).max(120),
		description: z.string().min(1).max(500),
		/** The table the figures come from, shown on the report itself. */
		dataSource: z.string().min(1).max(64),
		/** The subset of the approved list this report can actually apply. */
		filters: z.array(ReportFilterKeySchema),
	})
	.strict()

export const ListReportDefinitionsOutputSchema = z
	.object({ definitions: z.array(ReportDefinitionSchema) })
	.strict()

/**
 * One report's figures, tagged with the definition that produced them.
 *
 * A KPI adds a member here and a row to the registry. The framework itself
 * stays as it is.
 */
export const ReportResultSchema = z.discriminatedUnion("definitionKey", [
	z
		.object({ definitionKey: z.literal("engagement"), engagement: EngagementSummarySchema })
		.strict(),
	z
		.object({ definitionKey: z.literal("retention"), retention: RetentionSummarySchema })
		.strict(),
	z.object({ definitionKey: z.literal("adoption"), adoption: AdoptionSummarySchema }).strict(),
	z.object({ definitionKey: z.literal("activity"), activity: ActivitySummarySchema }).strict(),
	z.object({ definitionKey: z.literal("audit"), audit: AuditReportSchema }).strict(),
])

export type ReportResult = z.infer<typeof ReportResultSchema>

const RangeShape = {
	from: z.iso.date(),
	to: z.iso.date(),
}

/**
 * A request to run a report.
 *
 * The run id is minted by the client, as RF-2 does everywhere else, so a retry
 * after a lost response returns the first run rather than generating a second
 * report of the same thing.
 */
export const GenerateReportInputSchema = z
	.object({
		id: z.uuid(),
		definitionKey: ReportDefinitionKeySchema,
		...RangeShape,
		filters: ReportFiltersSchema.default({}),
	})
	.strict()
	.refine(input => input.from <= input.to, {
		message: "The range must start on or before it ends",
		path: ["from"],
	})
	.refine(
		input =>
			(Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) /
				86_400_000 <=
			366,
		{ message: "A range may not exceed 366 days", path: ["to"] }
	)

export const ReportRunSchema = z
	.object({
		id: z.uuid(),
		definitionKey: ReportDefinitionKeySchema,
		definitionName: z.string().min(1).max(120),
		dataSource: z.string().min(1).max(64),
		/** When the report was generated, which is not when the data happened. */
		generatedAt: z.iso.datetime({ offset: true }),
		generatedBy: z.string().min(1),
		...RangeShape,
		timezone: z.literal("Asia/Manila"),
		filters: ReportFiltersSchema,
		/** True when the report was withheld rather than computed. */
		suppressed: z.boolean(),
		suppressionReason: z.string().min(1).max(500).nullable(),
		result: ReportResultSchema.nullable(),
	})
	.strict()

/** A query string carries text, so the limit is coerced as paging is elsewhere. */
export const ListReportRunsInputSchema = z
	.object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
	.strict()

/**
 * The formats §4.2-K asks for.
 *
 * Excel, Word and a PDF reader are the three things a BSP report is opened in,
 * so all three are first-class rather than one canonical format and two
 * conversions of it.
 */
export const REPORT_EXPORT_FORMATS = ["xlsx", "docx", "pdf"] as const
export const ReportExportFormatSchema = z.enum(REPORT_EXPORT_FORMATS)
export type ReportExportFormat = z.infer<typeof ReportExportFormatSchema>

export const ExportReportInputSchema = z
	.object({ runId: z.uuid(), format: ReportExportFormatSchema })
	.strict()

export const ListReportRunsOutputSchema = z
	.object({ runs: z.array(ReportRunSchema) })
	.strict()

export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>
export type GenerateReportInput = z.infer<typeof GenerateReportInputSchema>
export type ReportRun = z.infer<typeof ReportRunSchema>
