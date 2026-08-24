CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY,
	"account_id" text,
	"device_pseudo_id" text,
	"purpose" text NOT NULL,
	"notice_id" uuid NOT NULL,
	"notice_version" text NOT NULL,
	"status" text NOT NULL,
	"responded_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_record_subject_xor_check" CHECK (("account_id" is not null) <> ("device_pseudo_id" is not null)),
	CONSTRAINT "consent_record_device_pseudo_id_check" CHECK ("device_pseudo_id" is null or "device_pseudo_id" ~ '^[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "consent_record_purpose_check" CHECK ("purpose" in ('registration', 'survey', 'demographic_analytics')),
	CONSTRAINT "consent_record_status_check" CHECK ("status" in ('granted', 'declined', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "privacy_notice" (
	"id" uuid PRIMARY KEY,
	"version" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"source_url" text NOT NULL,
	"content_sha256" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_notice_id_version_unique" UNIQUE("id","version"),
	CONSTRAINT "privacy_notice_content_sha256_check" CHECK ("content_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "consent_record_account_purpose_recorded_idx" ON "consent_record" ("account_id","purpose","recorded_at" DESC NULLS LAST) WHERE "account_id" is not null;--> statement-breakpoint
CREATE INDEX "consent_record_device_purpose_recorded_idx" ON "consent_record" ("device_pseudo_id","purpose","recorded_at" DESC NULLS LAST) WHERE "device_pseudo_id" is not null;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_notice_id_version_fkey" FOREIGN KEY ("notice_id","notice_version") REFERENCES "privacy_notice"("id","version") ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO "module_configuration" ("key", "value")
VALUES ('active_privacy_notice_version', '"2024-12-26"'::jsonb)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_pisocamp_consent_evidence_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "privacy_notice_append_only"
BEFORE UPDATE OR DELETE ON "privacy_notice"
FOR EACH ROW EXECUTE FUNCTION "prevent_pisocamp_consent_evidence_mutation"();
--> statement-breakpoint
CREATE TRIGGER "consent_record_append_only"
BEFORE UPDATE OR DELETE ON "consent_record"
FOR EACH ROW EXECUTE FUNCTION "prevent_pisocamp_consent_evidence_mutation"();
