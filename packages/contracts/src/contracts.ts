/**
 * Central contract registry
 * Re-exports version routers
 */

// V1 contracts (routers)
export { v1Contract } from "./modules/v1/v1.contract.js"
export type { V1Contract } from "./modules/v1/v1.contract.js"

// Example todos schemas + types
export {
	TodoSchema,
	CreateTodoSchema,
	UpdateTodoRequestSchema,
} from "./modules/v1/examples/todos/todos.schema.js"
export type {
	Todo,
	CreateTodoInput,
	UpdateTodoRequest,
} from "./modules/v1/examples/todos/todos.schema.js"

// Ticket schemas + inferred types (HY-2 / F-62 wires the web form to these)
export {
	TicketSchema,
	CreateTicketSchema,
	TicketIdSchema,
	TicketPrioritySchema,
	TicketStatusSchema,
} from "./modules/v1/tickets/tickets.schema.js"
export type {
	Ticket,
	CreateTicketInput,
	TicketIdInput,
} from "./modules/v1/tickets/tickets.schema.js"

// RBAC catalog (shared constants, enums, types)
export * from "./modules/v1/rbac/rbac.catalog.js"

// RBAC administration contract + schemas
export { rbacContract } from "./modules/v1/rbac/rbac.contract.js"
export {
	RoleSchema,
	CreateRoleSchema,
	UpdateRoleRequestSchema,
	SetRolePermissionsRequestSchema,
	RoleIdSchema,
	DeleteRoleResponseSchema,
	PermissionSchema,
	UserWithRolesSchema,
	AssignRoleRequestSchema,
	RemoveRoleRequestSchema,
	UserRoleMutationResponseSchema,
	AuditOutcomeSchema,
	AuditLogEntrySchema,
	ListAuditLogRequestSchema,
	ListAuditLogResponseSchema,
} from "./modules/v1/rbac/rbac.schema.js"
export type {
	Role,
	CreateRoleInput,
	UpdateRoleRequest,
	SetRolePermissionsRequest,
	PermissionCatalogEntry,
	UserWithRoles,
	AssignRoleRequest,
	RemoveRoleRequest,
	AuditOutcome,
	AuditLogEntry,
	ListAuditLogRequest,
	ListAuditLogResponse,
} from "./modules/v1/rbac/rbac.schema.js"

// Current-user access schemas
export { meContract } from "./modules/v1/me/me.contract.js"
export { MePermissionsSchema } from "./modules/v1/me/me.schema.js"
export type { MePermissions } from "./modules/v1/me/me.schema.js"

// Piso CAMP public and administrator configuration schemas
export {
	CONSENT_DECISIONS,
	CONSENT_PURPOSES,
	CONSENT_STATES,
	ConsentDecisionSchema,
	ConsentPurposeSchema,
	ConsentStateSchema,
	DevicePseudoIdSchema,
	GetPisoCampConsentInputSchema,
	PisoCampConsentStatusSchema,
	PisoCampPrivacyNoticeSchema,
	PisoCampProfileOutputSchema,
	PisoCampProfileSchema,
	PisoCampPublicConfigSchema,
	PisoCampAdminConfigSchema,
	RecordPisoCampConsentInputSchema,
	RecordedPisoCampConsentSchema,
	UpdatePisoCampAdminConfigSchema,
} from "./modules/v1/pisocamp/pisocamp.schema.js"
export type {
	ConsentDecision,
	ConsentPurpose,
	ConsentState,
	PisoCampConsentStatus,
	PisoCampPrivacyNotice,
	PisoCampPublicConfig,
	PisoCampAdminConfig,
	RecordPisoCampConsentInput,
	RecordedPisoCampConsent,
	UpdatePisoCampAdminConfig,
} from "./modules/v1/pisocamp/pisocamp.schema.js"

// Piso CAMP draft-content administration schemas
export { pisoCampContentContract } from "./modules/v1/pisocamp/content.contract.js"
export {
	ApprovePisoCampContentInputSchema,
	ArchivePisoCampContentInputSchema,
	CONTENT_STATUSES,
	CONTENT_TYPES,
	CreatePisoCampContentInputSchema,
	DeactivatePisoCampContentInputSchema,
	ListPisoCampContentInputSchema,
	ListPisoCampContentOutputSchema,
	ListPisoCampContentReviewQueueInputSchema,
	ListPisoCampContentReviewQueueOutputSchema,
	PISO_CAMP_CONTENT_REVIEW_QUEUE_STATUSES,
	PISO_CAMP_CONTENT_WORKFLOW_ACTIONS,
	MAX_SURVEY_QUESTIONS,
	NPS_BANDS,
	npsBandFor,
	PISO_CAMP_CURRENCY_SERIES_CODES,
	PisoCampContentDetailSchema,
	PisoCampContentDraftSchema,
	PisoCampContentItemIdSchema,
	PisoCampContentReviewDetailSchema,
	PisoCampContentReviewQueueStatusSchema,
	PisoCampContentReviewQueueSummarySchema,
	PisoCampContentReviewVersionSchema,
	PisoCampContentStatusSchema,
	PisoCampContentSummarySchema,
	PisoCampContentTypeSchema,
	PisoCampContentVersionSchema,
	PisoCampContentWorkflowActionSchema,
	PisoCampCurrencyCatalogSchema,
	PisoCampCurrencySeriesCodeSchema,
	PisoCampRelatedLinkInputSchema,
	PisoCampRelatedLinkOutputSchema,
	PisoCampSurveyPurposeSchema,
	PisoCampSurveyQuestionKindSchema,
	PisoCampSurveyQuestionOutputSchema,
	PisoCampSurveyQuestionSchema,
	PublishPisoCampContentInputSchema,
	SURVEY_PURPOSES,
	SURVEY_QUESTION_KINDS,
	SURVEY_SCALES,
	RejectPisoCampContentInputSchema,
	SchedulePisoCampContentPublicationInputSchema,
	SubmitPisoCampContentInputSchema,
	UnpublishPisoCampContentInputSchema,
	UpdatePisoCampContentInputSchema,
} from "./modules/v1/pisocamp/content.schema.js"
export type {
	ArchivePisoCampContentInput,
	DeactivatePisoCampContentInput,
	SchedulePisoCampContentPublicationInput,
	UnpublishPisoCampContentInput,
} from "./modules/v1/pisocamp/content.schema.js"

// AN-1 Piso CAMP analytics event catalog and routes
export { pisoCampAnalyticsContract } from "./modules/v1/pisocamp/analytics.contract.js"
export {
	ANALYTICS_EVENT_NAMES,
	AnalyticsEventSchema,
	IngestAnalyticsEventsInputSchema,
	IngestAnalyticsEventsOutputSchema,
	ModuleEntryTodaySchema,
	UuidV4Schema,
} from "./modules/v1/pisocamp/analytics.schema.js"
export type {
	AnalyticsEvent,
	IngestAnalyticsEventsInput,
	IngestAnalyticsEventsOutput,
	ModuleEntryToday,
} from "./modules/v1/pisocamp/analytics.schema.js"

// CM-2 governed content asset protocol
export { pisoCampAssetContract } from "./modules/v1/pisocamp/asset.contract.js"
export {
	AttachPisoCampAssetInputSchema,
	AttachPisoCampAssetOutputSchema,
	DeletePisoCampAssetInputSchema,
	DeletePisoCampAssetOutputSchema,
	DetachPisoCampAssetInputSchema,
	DetachPisoCampAssetOutputSchema,
	ListPisoCampAssetsOutputSchema,
	PISO_CAMP_ASSET_MEDIA_TYPE_MAX_BYTES,
	PISO_CAMP_ASSET_MEDIA_TYPES,
	PISO_CAMP_ASSET_ROLES,
	PisoCampAssetMediaTypeSchema,
	PisoCampAssetMutationOutputSchema,
	PisoCampAssetRoleSchema,
	PisoCampAssetSchema,
	PisoCampVersionAssetSchema,
	UploadPisoCampAssetInputSchema,
	UploadPisoCampAssetOutputSchema,
} from "./modules/v1/pisocamp/asset.schema.js"
export type {
	AttachPisoCampAssetInput,
	AttachPisoCampAssetOutput,
	DeletePisoCampAssetInput,
	DeletePisoCampAssetOutput,
	DetachPisoCampAssetInput,
	DetachPisoCampAssetOutput,
	ListPisoCampAssetsOutput,
	PisoCampAsset,
	PisoCampAssetMediaType,
	PisoCampAssetMutationOutput,
	PisoCampAssetRole,
	PisoCampVersionAsset,
	UploadPisoCampAssetInput,
	UploadPisoCampAssetOutput,
} from "./modules/v1/pisocamp/asset.schema.js"

// CM-7 per-item content audit history
export {
	ListPisoCampContentAuditInputSchema,
	ListPisoCampContentAuditOutputSchema,
	PISO_CAMP_CONTENT_AUDIT_ACTIONS,
	PisoCampContentAuditActionSchema,
	PisoCampContentAuditEntrySchema,
} from "./modules/v1/pisocamp/content-audit.schema.js"
export type {
	ListPisoCampContentAuditInput,
	ListPisoCampContentAuditOutput,
	PisoCampContentAuditAction,
	PisoCampContentAuditEntry,
} from "./modules/v1/pisocamp/content-audit.schema.js"

// CM-4 version history and restore protocol
export {
	ListPisoCampContentVersionsInputSchema,
	ListPisoCampContentVersionsOutputSchema,
	PISO_CAMP_CONTENT_DIFF_FIELDS,
	PISO_CAMP_RESTORABLE_STATUSES,
	PISO_CAMP_RESTORE_SOURCE_ITEM_STATUSES,
	PisoCampContentDifferenceSchema,
	PisoCampContentDiffFieldSchema,
	PisoCampContentVersionHistoryEntrySchema,
	PisoCampRestorableStatusSchema,
	PisoCampRestoreSourceItemStatusSchema,
	RestorePisoCampContentVersionInputSchema,
} from "./modules/v1/pisocamp/version-history.schema.js"
export type {
	ListPisoCampContentVersionsInput,
	ListPisoCampContentVersionsOutput,
	PisoCampContentDiffField,
	PisoCampContentDifference,
	PisoCampContentVersionHistoryEntry,
	PisoCampRestorableStatus,
	RestorePisoCampContentVersionInput,
} from "./modules/v1/pisocamp/version-history.schema.js"

// CM-5 pre-publication content preview protocol
export {
	pisoCampContentPreviewContract,
	pisoCampPreviewContract,
} from "./modules/v1/pisocamp/preview.contract.js"
export {
	GetPisoCampContentPreviewInputSchema,
	PISO_CAMP_PREVIEWABLE_STATUSES,
	PisoCampContentPreviewAssetSchema,
	PisoCampContentPreviewGrantSchema,
	PisoCampContentPreviewSchema,
	PisoCampContentPreviewTokenSchema,
	PisoCampPreviewableStatusSchema,
	RedeemPisoCampContentPreviewInputSchema,
} from "./modules/v1/pisocamp/preview.schema.js"
export type {
	GetPisoCampContentPreviewInput,
	PisoCampContentPreview,
	PisoCampContentPreviewAsset,
	PisoCampContentPreviewGrant,
	PisoCampPreviewableStatus,
	RedeemPisoCampContentPreviewInput,
} from "./modules/v1/pisocamp/preview.schema.js"

// CE-1 signed offline bundle protocol
export { pisoCampBundleContract } from "./modules/v1/pisocamp/bundle.contract.js"
export {
	PisoCampBundleEnvelopeSchema,
	PisoCampBundleManifestEntrySchema,
	PisoCampBundleManifestSchema,
} from "./modules/v1/pisocamp/bundle.schema.js"
export type {
	PisoCampBundleEnvelope,
	PisoCampBundleManifest,
	PisoCampBundleManifestEntry,
} from "./modules/v1/pisocamp/bundle.schema.js"

// AN-3 adoption and feature usage
export {
	ADOPTION_FEATURES,
	AdoptionFeatureSchema,
	AdoptionRangeInputSchema,
	AdoptionSummarySchema,
	FeatureUsageSchema,
	KEY_ACTION_EVENTS,
	KeyActionEventSchema,
} from "./modules/v1/pisocamp/adoption.schema.js"
export type {
	AdoptionFeature,
	AdoptionSummary,
	FeatureUsage,
	KeyActionEvent,
} from "./modules/v1/pisocamp/adoption.schema.js"

// AN-5 gamification and trivia metrics
export {
	GamificationRangeInputSchema,
	GamificationSummarySchema,
	LeaderboardParticipationSchema,
	LearningReengagementSchema,
	TopPerformerRetentionSchema,
	TriviaParticipationSchema,
} from "./modules/v1/pisocamp/gamification.schema.js"
export type {
	GamificationSummary,
	LeaderboardParticipation,
	LearningReengagement,
	TopPerformerRetention,
	TriviaParticipation,
} from "./modules/v1/pisocamp/gamification.schema.js"

// AN-6 evaluation, ratings and NPS metrics
export {
	NpsBreakdownSchema,
	ScaleDistributionPointSchema,
	SurveyConsentStatusSchema,
	SurveyMetricSchema,
	SurveyMetricsRangeInputSchema,
	SurveyMetricsSummarySchema,
	SurveyQuestionMetricSchema,
} from "./modules/v1/pisocamp/survey-metrics.schema.js"
export type {
	NpsBreakdown,
	ScaleDistributionPoint,
	SurveyConsentStatus,
	SurveyMetric,
	SurveyMetricsSummary,
	SurveyQuestionMetric,
} from "./modules/v1/pisocamp/survey-metrics.schema.js"

// AN-7 technical health
export {
	ApiEndpointMetricSchema,
	CrashMetricsSchema,
	ImportMonitoringMetricsInputSchema,
	ImportMonitoringMetricsOutputSchema,
	LoadTimeMetricsSchema,
	MonitoringSourceSchema,
	NetworkFailureCountSchema,
	PerformanceTestResultSchema,
	RecordPerformanceTestInputSchema,
	TechnicalMetricsRangeInputSchema,
	TechnicalMetricsSummarySchema,
} from "./modules/v1/pisocamp/technical.schema.js"
export type {
	ApiEndpointMetricView,
	CrashMetrics,
	ImportMonitoringMetricsInput,
	LoadTimeMetrics,
	NetworkFailureCount,
	PerformanceTestResultView,
	RecordPerformanceTestInput,
	TechnicalMetricsSummary,
} from "./modules/v1/pisocamp/technical.schema.js"

// AN-10 demographic and cohort reports
export {
	DEMOGRAPHIC_DIMENSIONS,
	DemographicBucketSchema,
	DemographicDimensionSchema,
	DemographicDistributionSchema,
	DemographicDrilldownInputSchema,
	DemographicDrilldownSchema,
	DemographicMeasureSchema,
	DemographicsRangeInputSchema,
	DemographicsSummarySchema,
} from "./modules/v1/pisocamp/demographics.schema.js"
export type {
	DemographicBucket,
	DemographicDimension,
	DemographicDistribution,
	DemographicDrilldown,
	DemographicDrilldownInput,
	DemographicMeasure,
	DemographicsSummary,
} from "./modules/v1/pisocamp/demographics.schema.js"

// AN-11 install volume and store ratings
export {
	AcquisitionRangeInputSchema,
	AcquisitionSummarySchema,
	ImportStoreMetricsInputSchema,
	ImportStoreMetricsOutputSchema,
	InstallVolumeSchema,
	RatingConsolidationSchema,
	STORE_SOURCES,
	StoreMetricSchema,
	StoreSourceSchema,
} from "./modules/v1/pisocamp/acquisition.schema.js"
export type {
	AcquisitionSummary,
	ImportStoreMetricsInput,
	InstallVolume,
	RatingConsolidation,
	StoreMetric,
	StoreSource,
} from "./modules/v1/pisocamp/acquisition.schema.js"

// GM-5 progress
export { PisoCampProgressSchema } from "./modules/v1/pisocamp/progress.schema.js"
export type { PisoCampProgress } from "./modules/v1/pisocamp/progress.schema.js"

// GM-4 leaderboard
export {
	LEADERBOARD_PERIODS,
	LeaderboardInputSchema,
	LeaderboardPeriodSchema,
	LeaderboardSchema,
	LeaderboardStandingSchema,
	UpdateLeaderboardAliasInputSchema,
} from "./modules/v1/pisocamp/leaderboard.schema.js"
export type {
	Leaderboard,
	LeaderboardPeriod,
	LeaderboardStanding,
	UpdateLeaderboardAliasInput,
} from "./modules/v1/pisocamp/leaderboard.schema.js"

// SA-7 data subject export and deletion
export {
	DataSubjectExportSchema,
	DeletePisoCampSubjectDataInputSchema,
	DeletePisoCampSubjectDataOutputSchema,
} from "./modules/v1/pisocamp/data-subject.schema.js"
export type {
	DataSubjectExport,
	DeletePisoCampSubjectDataInput,
	DeletePisoCampSubjectDataOutput,
} from "./modules/v1/pisocamp/data-subject.schema.js"

// SA-2 role assignment
export {
	ListPisoCampRolesOutputSchema,
	PisoCampRoleSchema,
	SetPisoCampUserRolesInputSchema,
	SetPisoCampUserRolesOutputSchema,
} from "./modules/v1/pisocamp/role.schema.js"
export type {
	ListPisoCampRolesOutput,
	PisoCampRole,
	SetPisoCampUserRolesInput,
	SetPisoCampUserRolesOutput,
} from "./modules/v1/pisocamp/role.schema.js"

// SA-1 account activation and deactivation
export {
	ACCOUNT_STATUSES,
	AccountStatusSchema,
	ListPisoCampAccountsInputSchema,
	ListPisoCampAccountsOutputSchema,
	PisoCampAccountSchema,
	SetPisoCampAccountStatusInputSchema,
} from "./modules/v1/pisocamp/account.schema.js"
export type {
	AccountStatus,
	ListPisoCampAccountsInput,
	ListPisoCampAccountsOutput,
	PisoCampAccount,
	SetPisoCampAccountStatusInput,
} from "./modules/v1/pisocamp/account.schema.js"

// AN-8 the parameter-driven report framework
export {
	ActivitySummarySchema,
	DEMOGRAPHIC_FILTER_KEYS,
	ExportReportInputSchema,
	REPORT_EXPORT_FORMATS,
	ReportExportFormatSchema,
	GenerateReportInputSchema,
	ListReportDefinitionsOutputSchema,
	ListReportRunsInputSchema,
	ListReportRunsOutputSchema,
	REPORT_DEFINITIONS,
	REPORT_FILTER_KEYS,
	ReportDefinitionKeySchema,
	ReportDefinitionSchema,
	ReportFilterKeySchema,
	ReportFiltersSchema,
	ReportResultSchema,
	ReportRunSchema,
} from "./modules/v1/pisocamp/report.schema.js"
export type {
	ActivitySummary,
	GenerateReportInput,
	ReportDefinition,
	ReportDefinitionKey,
	ReportExportFormat,
	ReportFilterKey,
	ReportFilters,
	ReportResult,
	ReportRun,
} from "./modules/v1/pisocamp/report.schema.js"

// AN-4 retention, churn and lifetime
export {
	CohortRetentionSchema,
	RetentionPointSchema,
	RetentionRangeInputSchema,
	RetentionSummarySchema,
} from "./modules/v1/pisocamp/retention.schema.js"
export type {
	CohortRetention,
	RetentionPoint,
	RetentionSummary,
} from "./modules/v1/pisocamp/retention.schema.js"

// AN-2 engagement KPIs
export {
	ConcurrencyPeakSchema,
	DailyActiveSchema,
	EngagementRangeInputSchema,
	EngagementSummarySchema,
	HourlyActivitySchema,
} from "./modules/v1/pisocamp/engagement.schema.js"
export type {
	DailyActive,
	EngagementRangeInput,
	EngagementSummary,
	HourlyActivity,
} from "./modules/v1/pisocamp/engagement.schema.js"

// EV-3 survey trigger rules
export {
	DeletePisoCampSurveyTriggerInputSchema,
	DeletePisoCampSurveyTriggerOutputSchema,
	ListPisoCampSurveyTriggersOutputSchema,
	PisoCampSurveyTriggerConfigSchema,
	PisoCampSurveyTriggerRuleSchema,
	PisoCampSurveyTriggerTypeSchema,
	SURVEY_TRIGGER_PRIORITY,
	SURVEY_TRIGGER_TYPES,
	UpsertPisoCampSurveyTriggerInputSchema,
} from "./modules/v1/pisocamp/survey-trigger.schema.js"
export type {
	DeletePisoCampSurveyTriggerInput,
	ListPisoCampSurveyTriggersOutput,
	PisoCampSurveyTriggerConfig,
	PisoCampSurveyTriggerRule,
	PisoCampSurveyTriggerType,
	UpsertPisoCampSurveyTriggerInput,
} from "./modules/v1/pisocamp/survey-trigger.schema.js"

// EV-2 survey responses
export {
	IngestSurveyResponsesInputSchema,
	IngestSurveyResponsesOutputSchema,
	MAX_SURVEY_RESPONSE_BATCH,
	PisoCampSurveyAnswerSchema,
	PisoCampSurveyResponseSchema,
} from "./modules/v1/pisocamp/survey-response.schema.js"
export type {
	IngestSurveyResponsesInput,
	IngestSurveyResponsesOutput,
	PisoCampSurveyAnswer,
	PisoCampSurveyResponse,
} from "./modules/v1/pisocamp/survey-response.schema.js"

// GM-3 trivia responses
export {
	IngestTriviaResponsesInputSchema,
	IngestTriviaResponsesOutputSchema,
	MAX_TRIVIA_RESPONSE_BATCH,
	PisoCampTriviaResponseSchema,
	TRIVIA_POINTS,
} from "./modules/v1/pisocamp/trivia.schema.js"
export type {
	IngestTriviaResponsesInput,
	IngestTriviaResponsesOutput,
	PisoCampTriviaResponse,
} from "./modules/v1/pisocamp/trivia.schema.js"

// CE-4 approved tactile simulation vocabulary
export {
	PisoCampTactileMapSchema,
	PisoCampTactilePatternIdSchema,
	PisoCampTactileRegionSchema,
	PisoCampTiltEffectIdSchema,
	PisoCampTiltEffectSchema,
	TACTILE_PATTERN_IDS,
	TILT_EFFECT_IDS,
} from "./modules/v1/pisocamp/tactile.schema.js"
export type {
	PisoCampTactileMap,
	PisoCampTactilePatternId,
	PisoCampTactileRegion,
	PisoCampTiltEffect,
	PisoCampTiltEffectId,
} from "./modules/v1/pisocamp/tactile.schema.js"
export type {
	ApprovePisoCampContentInput,
	CreatePisoCampContentInput,
	ListPisoCampContentInput,
	ListPisoCampContentOutput,
	ListPisoCampContentReviewQueueInput,
	ListPisoCampContentReviewQueueOutput,
	PisoCampContentDetail,
	PisoCampContentDraft,
	PisoCampContentReviewDetail,
	PisoCampContentReviewQueueStatus,
	PisoCampContentReviewQueueSummary,
	PisoCampContentReviewVersion,
	PisoCampContentStatus,
	PisoCampContentSummary,
	PisoCampContentType,
	PisoCampContentVersion,
	PisoCampContentWorkflowAction,
	PisoCampCurrencyCatalog,
	PisoCampRelatedLinkInput,
	PisoCampRelatedLinkOutput,
	PisoCampSurveyPurpose,
	PisoCampSurveyQuestion,
	PisoCampSurveyQuestionKind,
	PisoCampSurveyQuestionOutput,
	PublishPisoCampContentInput,
	RejectPisoCampContentInput,
	SubmitPisoCampContentInput,
	UpdatePisoCampContentInput,
} from "./modules/v1/pisocamp/content.schema.js"

// Future versions:
// export { v2Contract, type V2Contract } from "./modules/v2/v2.contract.js"
// export const v2 = { ... }
// export type { Todo as V2Todo, ... } from "./modules/v2/..."
