CREATE TABLE "survey_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"response_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"scale_value" integer,
	"text_value" text,
	"skipped" boolean DEFAULT false NOT NULL,
	CONSTRAINT "survey_answer_response_question_unique" UNIQUE("response_id","question_id"),
	CONSTRAINT "survey_answer_shape_check" CHECK ((
				("skipped" and "scale_value" is null and "text_value" is null)
				or (not "skipped" and "scale_value" is not null and "text_value" is null)
				or (not "skipped" and "scale_value" is null and "text_value" is not null)
			)),
	CONSTRAINT "survey_answer_scale_check" CHECK ("scale_value" is null or "scale_value" between 0 and 10),
	CONSTRAINT "survey_answer_text_check" CHECK ("text_value" is null or ("text_value" = btrim("text_value") and char_length("text_value") between 1 and 1000))
);
--> statement-breakpoint
CREATE TABLE "survey_response" (
	"response_id" uuid PRIMARY KEY,
	"content_item_id" uuid NOT NULL,
	"content_version_id" uuid NOT NULL,
	"consent_record_id" uuid NOT NULL,
	"account_id" text,
	"device_pseudo_id" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_response_subject_xor_check" CHECK (("account_id" is not null) <> ("device_pseudo_id" is not null)),
	CONSTRAINT "survey_response_device_pseudo_id_check" CHECK ("device_pseudo_id" is null or "device_pseudo_id" ~ '^[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
CREATE INDEX "survey_answer_question_idx" ON "survey_answer" ("question_id");--> statement-breakpoint
CREATE INDEX "survey_response_item_idx" ON "survey_response" ("content_item_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "survey_response_consent_idx" ON "survey_response" ("consent_record_id");--> statement-breakpoint
ALTER TABLE "survey_answer" ADD CONSTRAINT "survey_answer_response_id_survey_response_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "survey_response"("response_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "survey_answer" ADD CONSTRAINT "survey_answer_question_id_survey_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "survey_question"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_consent_record_id_consent_record_id_fkey" FOREIGN KEY ("consent_record_id") REFERENCES "consent_record"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_name_check", ADD CONSTRAINT "analytics_event_name_check" CHECK ("event_name" in ('module_entry', 'account_prompt_shown', 'account_prompt_guest',
				'content_view', 'feature_use', 'link_open', 'trivia_prompt_shown',
				'trivia_prompt_answered', 'trivia_prompt_skipped', 'survey_prompt_shown',
				'survey_declined', 'survey_submitted'));--> statement-breakpoint
ALTER TABLE "analytics_event" DROP CONSTRAINT "analytics_event_catalog_check", ADD CONSTRAINT "analytics_event_catalog_check" CHECK ((
				("event_name" = 'module_entry' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'completed')
				or ("event_name" = 'account_prompt_shown' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'account_prompt_guest' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'content_view' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
				or ("event_name" = 'link_open' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
				or ("event_name" = 'feature_use' and "screen" in ('coin_3d_viewer', 'tactile_viewer', 'tilt_viewer') and "feature" in ('3d_coin', 'haptic', 'tilt') and "status" = 'completed')
				or ("event_name" in ('trivia_prompt_shown', 'trivia_prompt_answered', 'trivia_prompt_skipped') and "screen" = 'trivia_prompt' and "feature" = 'trivia' and "status" = 'completed')
				or ("event_name" in ('survey_prompt_shown', 'survey_declined', 'survey_submitted') and "screen" = 'survey_prompt' and "feature" = 'survey' and "status" = 'completed')
			));--> statement-breakpoint
ALTER TABLE "content_item" DROP CONSTRAINT "content_item_type_check", ADD CONSTRAINT "content_item_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question', 'survey'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_type_check", ADD CONSTRAINT "content_version_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question', 'survey'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_fields_check", ADD CONSTRAINT "content_version_fields_check" CHECK ((
				("content_type" = 'banknote' and "series_code" in ('fpp-banknotes', 'engc-banknotes', 'ngc-banknotes') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'coin' and "series_code" in ('ngc-coins', 'bsp-coin-series') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'security_feature' and "series_code" is not null and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'advisory' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'link' and "series_code" is null and "denomination_code" is null and "primary_url" is not null)
				or ("content_type" = 'trivia_question' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'survey' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
			));