CREATE TABLE "recognition_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"version" text NOT NULL CONSTRAINT "recognition_model_version_unique" UNIQUE,
	"status" text DEFAULT 'active' NOT NULL,
	"classes" jsonb NOT NULL,
	"confidence_threshold" double precision NOT NULL,
	"dwell_seconds" integer NOT NULL,
	"weights_sha256" text NOT NULL,
	"weights_byte_length" integer NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "recognition_model_version_check" CHECK ("version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and char_length("version") between 1 and 64),
	CONSTRAINT "recognition_model_status_check" CHECK ("status" in ('active', 'retired')),
	CONSTRAINT "recognition_model_threshold_check" CHECK ("confidence_threshold" between 0.5 and 1),
	CONSTRAINT "recognition_model_dwell_check" CHECK ("dwell_seconds" between 1 and 60),
	CONSTRAINT "recognition_model_weights_digest_check" CHECK ("weights_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "recognition_model_weights_size_check" CHECK ("weights_byte_length" between 1 and 5242880),
	CONSTRAINT "recognition_model_classes_check" CHECK (jsonb_typeof("classes") = 'array' and jsonb_array_length("classes") between 1 and 512),
	CONSTRAINT "recognition_model_retired_check" CHECK (("status" = 'retired') = ("retired_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD COLUMN "reason" text DEFAULT 'content' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ALTER COLUMN "published_version_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_model_single_active_idx" ON "recognition_model" ("status") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "recognition_model_status_idx" ON "recognition_model" ("status","published_at");--> statement-breakpoint
ALTER TABLE "recognition_model" ADD CONSTRAINT "recognition_model_published_by_users_id_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD CONSTRAINT "content_bundle_rebuild_request_reason_check" CHECK ("reason" in ('content', 'recognition_model'));--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD CONSTRAINT "content_bundle_rebuild_request_origin_check" CHECK (("reason" = 'content') = ("item_id" is not null)
				and ("item_id" is null) = ("published_version_id" is null));--> statement-breakpoint
-- DR-4: a rebuild can now be due for something no content version caused, so
-- the CM-6 guard only applies to the rows it was written for. Without this the
-- trigger refuses a model publication, and the model never reaches a device.
CREATE OR REPLACE FUNCTION "content_bundle_rebuild_request_validate_published_version"() RETURNS trigger AS $$
BEGIN
	IF NEW."reason" <> 'content' THEN
		RETURN NEW;
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM "content_version"
		WHERE "id" = NEW."published_version_id"
			AND "item_id" = NEW."item_id"
			AND (
				("status" = 'published' AND "transition_action" = 'publish')
				OR ("status" = 'unpublished' AND "transition_action" = 'unpublish')
				OR ("status" = 'deactivated' AND "transition_action" = 'deactivate')
				OR ("status" = 'archived' AND "transition_action" = 'archive')
			)
	) THEN
		RAISE EXCEPTION 'only a bundle-affecting transition version can be enqueued' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
