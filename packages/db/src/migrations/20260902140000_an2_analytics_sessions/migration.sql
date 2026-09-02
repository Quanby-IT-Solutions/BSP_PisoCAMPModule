CREATE TABLE "analytics_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subject_pseudo_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"duration_seconds" integer NOT NULL,
	"event_count" integer NOT NULL,
	"screen_view_count" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_session_subject_start_unique" UNIQUE("subject_pseudo_id","started_at"),
	CONSTRAINT "analytics_session_subject_pseudo_id_check" CHECK ("subject_pseudo_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "analytics_session_interval_check" CHECK ("ended_at" >= "started_at"),
	CONSTRAINT "analytics_session_duration_check" CHECK ("duration_seconds" >= 0),
	CONSTRAINT "analytics_session_counts_check" CHECK ("event_count" > 0 and "screen_view_count" > 0 and "screen_view_count" <= "event_count")
);
--> statement-breakpoint
CREATE INDEX "analytics_session_local_date_idx" ON "analytics_session" ("local_date");--> statement-breakpoint
CREATE INDEX "analytics_session_started_at_idx" ON "analytics_session" ("started_at");--> statement-breakpoint
CREATE INDEX "analytics_session_subject_started_idx" ON "analytics_session" ("subject_pseudo_id","started_at");