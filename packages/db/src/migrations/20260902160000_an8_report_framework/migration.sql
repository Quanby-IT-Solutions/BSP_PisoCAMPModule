CREATE TABLE "report_definition" (
	"key" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"data_source" text NOT NULL,
	"supported_filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_run" (
	"id" uuid PRIMARY KEY,
	"definition_key" text NOT NULL,
	"requested_by" text,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"filters" jsonb NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"suppression_reason" text,
	"result" jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_run_range_check" CHECK ("from_date" <= "to_date"),
	CONSTRAINT "report_run_suppression_check" CHECK (("suppressed" and "suppression_reason" is not null and "result" is null)
				or (not "suppressed" and "suppression_reason" is null and "result" is not null))
);
--> statement-breakpoint
CREATE INDEX "report_run_generated_at_idx" ON "report_run" ("generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "report_run_definition_idx" ON "report_run" ("definition_key","generated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "report_run" ADD CONSTRAINT "report_run_definition_key_report_definition_key_fkey" FOREIGN KEY ("definition_key") REFERENCES "report_definition"("key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "report_run" ADD CONSTRAINT "report_run_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL;