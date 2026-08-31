CREATE TABLE "analytics_event" (
	"event_id" uuid PRIMARY KEY,
	"schema_version" integer NOT NULL,
	"event_name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject_pseudo_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"account_type" text NOT NULL,
	"screen" text NOT NULL,
	"feature" text NOT NULL,
	"app_version" text NOT NULL,
	"os_name" text NOT NULL,
	"os_version" text NOT NULL,
	"device_category" text NOT NULL,
	"network_state" text NOT NULL,
	"status" text NOT NULL,
	"properties" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_schema_version_check" CHECK ("schema_version" = 1),
	CONSTRAINT "analytics_event_name_check" CHECK ("event_name" in ('module_entry', 'account_prompt_shown', 'account_prompt_guest', 'content_view')),
	CONSTRAINT "analytics_event_subject_pseudo_id_check" CHECK ("subject_pseudo_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "analytics_event_account_type_check" CHECK ("account_type" in ('guest', 'registered')),
	CONSTRAINT "analytics_event_catalog_check" CHECK ((
				("event_name" = 'module_entry' and "screen" = 'pisocamp_home' and "feature" = 'module' and "status" = 'completed')
				or ("event_name" = 'account_prompt_shown' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'account_prompt_guest' and "screen" = 'pisocamp_home' and "feature" = 'account_prompt' and "status" = 'completed')
				or ("event_name" = 'content_view' and "screen" = 'currency_detail' and "feature" = 'currency_education' and "status" = 'completed')
			)),
	CONSTRAINT "analytics_event_app_version_check" CHECK ("app_version" = btrim("app_version") and char_length("app_version") between 1 and 64),
	CONSTRAINT "analytics_event_os_name_check" CHECK ("os_name" in ('android', 'ios', 'other')),
	CONSTRAINT "analytics_event_os_version_check" CHECK ("os_version" = btrim("os_version") and char_length("os_version") between 1 and 96),
	CONSTRAINT "analytics_event_device_category_check" CHECK ("device_category" in ('phone', 'tablet', 'other')),
	CONSTRAINT "analytics_event_network_state_check" CHECK ("network_state" in ('online', 'offline', 'unknown')),
	CONSTRAINT "analytics_event_status_check" CHECK ("status" in ('completed', 'failed', 'cancelled')),
	CONSTRAINT "analytics_event_properties_object_check" CHECK (jsonb_typeof("properties") = 'object')
);
--> statement-breakpoint
CREATE INDEX "analytics_event_name_occurred_at_idx" ON "analytics_event" ("event_name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_event_subject_occurred_at_idx" ON "analytics_event" ("subject_pseudo_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_event_session_occurred_at_idx" ON "analytics_event" ("session_id","occurred_at");
