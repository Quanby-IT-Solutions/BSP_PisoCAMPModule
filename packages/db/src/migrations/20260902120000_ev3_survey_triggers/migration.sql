CREATE TABLE "survey_trigger_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_item_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"page_depth" integer,
	"frequency_cap_days" integer,
	"priority" integer DEFAULT 50 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_trigger_rule_item_type_unique" UNIQUE("content_item_id","trigger_type"),
	CONSTRAINT "survey_trigger_rule_type_check" CHECK ("trigger_type" in ('page_depth', 'activity_completion', 'topic_completion', 'module_exit', 'app_exit')),
	CONSTRAINT "survey_trigger_rule_page_depth_check" CHECK (("trigger_type" = 'page_depth') = ("page_depth" is not null)
				and ("page_depth" is null or "page_depth" between 1 and 50)),
	CONSTRAINT "survey_trigger_rule_frequency_check" CHECK ("frequency_cap_days" is null or "frequency_cap_days" between 1 and 365),
	CONSTRAINT "survey_trigger_rule_priority_check" CHECK ("priority" between 1 and 100)
);
--> statement-breakpoint
CREATE INDEX "survey_trigger_rule_enabled_idx" ON "survey_trigger_rule" ("priority") WHERE "enabled";--> statement-breakpoint
ALTER TABLE "survey_trigger_rule" ADD CONSTRAINT "survey_trigger_rule_content_item_id_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "survey_trigger_rule" ADD CONSTRAINT "survey_trigger_rule_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "survey_trigger_rule" ADD CONSTRAINT "survey_trigger_rule_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT;