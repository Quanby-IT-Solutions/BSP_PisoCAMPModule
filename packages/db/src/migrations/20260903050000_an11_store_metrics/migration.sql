CREATE TABLE "store_metric_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"installs" integer NOT NULL,
	"uninstalls" integer DEFAULT 0 NOT NULL,
	"rating_average" double precision,
	"rating_count" integer,
	"imported_by" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_metric_import_source_period_unique" UNIQUE("source","period_start","period_end"),
	CONSTRAINT "store_metric_import_source_check" CHECK ("source" in ('google_play', 'app_store')),
	CONSTRAINT "store_metric_import_range_check" CHECK ("period_start" <= "period_end"),
	CONSTRAINT "store_metric_import_counts_check" CHECK ("installs" >= 0 and "uninstalls" >= 0),
	CONSTRAINT "store_metric_import_rating_check" CHECK (("rating_average" is null and "rating_count" is null)
				or ("rating_average" between 1 and 5 and "rating_count" > 0))
);
--> statement-breakpoint
CREATE INDEX "store_metric_import_period_idx" ON "store_metric_import" ("period_start","period_end");--> statement-breakpoint
ALTER TABLE "store_metric_import" ADD CONSTRAINT "store_metric_import_imported_by_users_id_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_name_check", ADD CONSTRAINT "analytics_event_name_check" CHECK ("event_name" in ('module_entry', 'account_prompt_shown', 'account_prompt_guest',
				'content_view', 'feature_use', 'link_open', 'trivia_prompt_shown',
				'trivia_prompt_answered', 'trivia_prompt_skipped', 'survey_prompt_shown',
				'survey_declined', 'survey_submitted', 'advisory_shown', 'profile_created',
				'module_load', 'network_failure', 'first_open'));--> statement-breakpoint
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
				or ("event_name" = 'first_open' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'completed')
			));