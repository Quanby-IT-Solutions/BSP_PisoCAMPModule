CREATE TABLE "api_endpoint_metric" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"endpoint" text NOT NULL,
	"request_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"timeout_count" integer NOT NULL,
	"auth_failure_count" integer NOT NULL,
	"latency_p50_ms" integer NOT NULL,
	"latency_p95_ms" integer NOT NULL,
	"imported_by" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_endpoint_metric_period_endpoint_unique" UNIQUE("source","period_start","period_end","endpoint"),
	CONSTRAINT "api_endpoint_metric_range_check" CHECK ("period_start" <= "period_end"),
	CONSTRAINT "api_endpoint_metric_counts_check" CHECK ("request_count" >= 0 and "error_count" >= 0 and "timeout_count" >= 0
				and "auth_failure_count" >= 0
				and "error_count" <= "request_count"
				and "timeout_count" <= "request_count"
				and "auth_failure_count" <= "request_count"),
	CONSTRAINT "api_endpoint_metric_latency_check" CHECK ("latency_p50_ms" >= 0 and "latency_p95_ms" >= "latency_p50_ms")
);
--> statement-breakpoint
CREATE TABLE "crash_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"crash_count" integer NOT NULL,
	"affected_users" integer NOT NULL,
	"affected_sessions" integer NOT NULL,
	"total_sessions" integer NOT NULL,
	"imported_by" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crash_snapshot_source_period_unique" UNIQUE("source","period_start","period_end"),
	CONSTRAINT "crash_snapshot_range_check" CHECK ("period_start" <= "period_end"),
	CONSTRAINT "crash_snapshot_counts_check" CHECK ("crash_count" >= 0 and "affected_users" >= 0
				and "affected_sessions" >= 0 and "total_sessions" >= 0
				and "affected_sessions" <= "total_sessions")
);
--> statement-breakpoint
CREATE TABLE "performance_test_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tested_at" date NOT NULL,
	"app_version" text NOT NULL,
	"platform" text NOT NULL,
	"device_model" text NOT NULL,
	"app_size_mb" double precision NOT NULL,
	"module_size_increase_mb" double precision NOT NULL,
	"downloaded_assets_mb" double precision NOT NULL,
	"local_storage_mb" double precision NOT NULL,
	"battery_impact_percent" double precision NOT NULL,
	"notes" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_test_result_platform_check" CHECK ("platform" in ('android', 'ios')),
	CONSTRAINT "performance_test_result_measures_check" CHECK ("app_size_mb" > 0 and "module_size_increase_mb" >= 0
				and "downloaded_assets_mb" >= 0 and "local_storage_mb" >= 0
				and "battery_impact_percent" >= 0 and "battery_impact_percent" <= 100),
	CONSTRAINT "performance_test_result_version_check" CHECK ("app_version" = btrim("app_version") and char_length("app_version") between 1 and 64),
	CONSTRAINT "performance_test_result_device_check" CHECK ("device_model" = btrim("device_model") and char_length("device_model") between 1 and 120),
	CONSTRAINT "performance_test_result_notes_check" CHECK ("notes" is null or ("notes" = btrim("notes") and char_length("notes") between 1 and 1000))
);
--> statement-breakpoint
CREATE INDEX "api_endpoint_metric_period_idx" ON "api_endpoint_metric" ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "crash_snapshot_period_idx" ON "crash_snapshot" ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "performance_test_result_tested_at_idx" ON "performance_test_result" ("tested_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "api_endpoint_metric" ADD CONSTRAINT "api_endpoint_metric_imported_by_users_id_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crash_snapshot" ADD CONSTRAINT "crash_snapshot_imported_by_users_id_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "performance_test_result" ADD CONSTRAINT "performance_test_result_recorded_by_users_id_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_name_check", ADD CONSTRAINT "analytics_event_name_check" CHECK ("event_name" in ('module_entry', 'account_prompt_shown', 'account_prompt_guest',
				'content_view', 'feature_use', 'link_open', 'trivia_prompt_shown',
				'trivia_prompt_answered', 'trivia_prompt_skipped', 'survey_prompt_shown',
				'survey_declined', 'survey_submitted', 'advisory_shown', 'profile_created',
				'module_load', 'network_failure'));--> statement-breakpoint
ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_catalog_check", ADD CONSTRAINT "analytics_event_catalog_check" CHECK ((
				("event_name" = 'module_entry' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'completed')
				or ("event_name" = 'account_prompt_shown' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'account_prompt_guest' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'content_view' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
				or ("event_name" = 'link_open' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
				or ("event_name" = 'feature_use' and "screen" in ('coin_3d_viewer', 'tactile_viewer', 'tilt_viewer') and "feature" in ('3d_coin', 'haptic', 'tilt') and "status" = 'completed')
				or ("event_name" in ('trivia_prompt_shown', 'trivia_prompt_answered', 'trivia_prompt_skipped') and "screen" = 'trivia_prompt' and "feature" = 'trivia' and "status" = 'completed')
				or ("event_name" in ('survey_prompt_shown', 'survey_declined', 'survey_submitted') and "screen" = 'survey_prompt' and "feature" = 'survey' and "status" = 'completed')
				or ("event_name" = 'advisory_shown' and "screen" = 'exit_advisory' and "feature" = 'advisory' and "status" = 'completed')
				or ("event_name" = 'profile_created' and "screen" = 'pisocamp_registration' and "feature" = 'account' and "status" = 'completed')
				or ("event_name" = 'module_load' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'completed')
				or ("event_name" = 'network_failure' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'failed')
			));