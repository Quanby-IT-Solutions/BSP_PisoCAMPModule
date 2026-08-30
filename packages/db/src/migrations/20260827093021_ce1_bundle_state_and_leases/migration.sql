CREATE TABLE "content_bundle_blob" (
	"sha256" text PRIMARY KEY,
	"byte_length" integer NOT NULL,
	"media_type" text NOT NULL,
	"body" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_bundle_blob_metadata_unique" UNIQUE("sha256","byte_length","media_type"),
	CONSTRAINT "content_bundle_blob_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "content_bundle_blob_size_check" CHECK ("byte_length" between 1 and 5242880),
	CONSTRAINT "content_bundle_blob_media_type_check" CHECK ("media_type" in ('application/json', 'image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "content_bundle_blob_body_length_check" CHECK (octet_length("body") = "byte_length")
);
--> statement-breakpoint
CREATE TABLE "content_bundle_channel" (
	"id" text PRIMARY KEY,
	"current_bundle_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_bundle_channel_primary_check" CHECK ("id" = 'primary')
);
--> statement-breakpoint
CREATE TABLE "content_bundle_manifest_entry" (
	"bundle_id" uuid,
	"logical_id" text,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"delivery" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"download_path" text NOT NULL,
	"content_item_id" uuid,
	"content_version_id" uuid,
	CONSTRAINT "content_bundle_manifest_entry_pkey" PRIMARY KEY("bundle_id","logical_id"),
	CONSTRAINT "content_bundle_manifest_entry_bundle_position_unique" UNIQUE("bundle_id","position"),
	CONSTRAINT "content_bundle_manifest_entry_logical_id_check" CHECK (char_length("logical_id") between 1 and 160 and "logical_id" ~ '^[a-z0-9]+([.:_-][a-z0-9]+)*$'),
	CONSTRAINT "content_bundle_manifest_entry_position_check" CHECK ("position" between 0 and 1999),
	CONSTRAINT "content_bundle_manifest_entry_kind_check" CHECK ("kind" in ('content', 'image')),
	CONSTRAINT "content_bundle_manifest_entry_delivery_check" CHECK ("delivery" in ('core', 'on_demand')),
	CONSTRAINT "content_bundle_manifest_entry_media_type_check" CHECK ("media_type" in ('application/json', 'image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "content_bundle_manifest_entry_size_check" CHECK ("byte_length" between 1 and 5242880),
	CONSTRAINT "content_bundle_manifest_entry_download_path_check" CHECK ("download_path" = '/pisocamp/bundle/resources/' || "sha256"),
	CONSTRAINT "content_bundle_manifest_entry_content_pair_check" CHECK (("content_item_id" is null) = ("content_version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "content_bundle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"version" bigint CONSTRAINT "content_bundle_version_unique" UNIQUE GENERATED ALWAYS AS IDENTITY (sequence name "content_bundle_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"state" text DEFAULT 'building' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"manifest_payload" text,
	"manifest_sha256" text,
	"algorithm" text,
	"key_id" text,
	"signature" text,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"core_byte_length" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "content_bundle_version_check" CHECK ("version" > 0),
	CONSTRAINT "content_bundle_state_check" CHECK ("state" in ('building', 'ready', 'failed')),
	CONSTRAINT "content_bundle_schema_version_check" CHECK ("schema_version" = 1),
	CONSTRAINT "content_bundle_size_check" CHECK ("entry_count" between 0 and 2000 and "core_byte_length" between 0 and 52428800),
	CONSTRAINT "content_bundle_envelope_check" CHECK ((
				("manifest_payload" is null and "manifest_sha256" is null and "algorithm" is null and "key_id" is null and "signature" is null)
				or (
					"manifest_payload" is not null
					and "manifest_sha256" is not null
					and "algorithm" is not null
					and "key_id" is not null
					and "signature" is not null
					and "manifest_payload" ~ '^[A-Za-z0-9_-]+$' and char_length("manifest_payload") <= 2796203
					and "manifest_sha256" ~ '^[a-f0-9]{64}$'
					and "algorithm" = 'Ed25519'
					and char_length("key_id") between 1 and 64 and "key_id" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
					and "signature" ~ '^[A-Za-z0-9_-]{86}$'
				)
			)),
	CONSTRAINT "content_bundle_failure_code_check" CHECK ("failure_code" is null or ("failure_code" ~ '^[a-z][a-z0-9_]{0,63}$')),
	CONSTRAINT "content_bundle_lifecycle_check" CHECK ((
				("state" = 'building' and "ready_at" is null and "failed_at" is null and "failure_code" is null and "manifest_payload" is null)
				or ("state" = 'ready' and "ready_at" is not null and "ready_at" >= "created_at" and "failed_at" is null and "failure_code" is null and "manifest_payload" is not null)
				or ("state" = 'failed' and "failed_at" is not null and "failed_at" >= "created_at" and "failure_code" is not null and "ready_at" is null and "manifest_payload" is null)
			))
);
--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD COLUMN "processed_bundle_id" uuid;--> statement-breakpoint
LOCK TABLE "content_bundle_rebuild_request" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" DISABLE TRIGGER "content_bundle_rebuild_request_immutable_trigger";--> statement-breakpoint
UPDATE "content_bundle_rebuild_request"
SET "state" = 'pending',
	"available_at" = statement_timestamp(),
	"processed_at" = NULL,
	"last_error" = NULL,
	"lease_owner" = NULL,
	"lease_expires_at" = NULL,
	"processed_bundle_id" = NULL;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ENABLE TRIGGER "content_bundle_rebuild_request_immutable_trigger";--> statement-breakpoint
CREATE INDEX "content_bundle_manifest_entry_bundle_idx" ON "content_bundle_manifest_entry" ("bundle_id","position");--> statement-breakpoint
CREATE INDEX "content_bundle_manifest_entry_content_trace_idx" ON "content_bundle_manifest_entry" ("content_item_id","content_version_id") WHERE "content_item_id" is not null;--> statement-breakpoint
CREATE INDEX "content_bundle_rebuild_request_lease_expiry_idx" ON "content_bundle_rebuild_request" ("lease_expires_at") WHERE "state" = 'processing';--> statement-breakpoint
CREATE INDEX "content_bundle_ready_version_idx" ON "content_bundle" ("version" DESC NULLS LAST) WHERE "state" = 'ready';--> statement-breakpoint
ALTER TABLE "content_bundle_channel" ADD CONSTRAINT "content_bundle_channel_current_bundle_id_content_bundle_id_fkey" FOREIGN KEY ("current_bundle_id") REFERENCES "content_bundle"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_bundle_manifest_entry" ADD CONSTRAINT "content_bundle_manifest_entry_bundle_fkey" FOREIGN KEY ("bundle_id") REFERENCES "content_bundle"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_bundle_manifest_entry" ADD CONSTRAINT "content_bundle_manifest_entry_blob_metadata_fkey" FOREIGN KEY ("sha256","byte_length","media_type") REFERENCES "content_bundle_blob"("sha256","byte_length","media_type") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_bundle_manifest_entry" ADD CONSTRAINT "content_bundle_manifest_entry_content_item_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD CONSTRAINT "content_bundle_rebuild_request_processed_bundle_fkey" FOREIGN KEY ("processed_bundle_id") REFERENCES "content_bundle"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD CONSTRAINT "content_bundle_rebuild_request_lease_owner_check" CHECK ("lease_owner" is null or ("lease_owner" = btrim("lease_owner") and char_length("lease_owner") between 1 and 128 and "lease_owner" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'));--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" DROP CONSTRAINT "content_bundle_rebuild_request_last_error_check", ADD CONSTRAINT "content_bundle_rebuild_request_last_error_check" CHECK ("last_error" is null or ("attempt_count" > 0 and "last_error" ~ '^[a-z][a-z0-9_]{0,63}$'));--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" DROP CONSTRAINT "content_bundle_rebuild_request_delivery_metadata_check", ADD CONSTRAINT "content_bundle_rebuild_request_delivery_metadata_check" CHECK ((
				("last_attempt_at" is null or "last_attempt_at" >= "created_at")
				and ("processed_at" is null or ("last_attempt_at" is not null and "processed_at" >= "last_attempt_at"))
				and ("lease_expires_at" is null or ("last_attempt_at" is not null and "lease_expires_at" > "last_attempt_at"))
				and (
					("state" = 'pending' and "processed_at" is null and "processed_bundle_id" is null and "lease_owner" is null and "lease_expires_at" is null and (("attempt_count" = 0 and "last_attempt_at" is null and "last_error" is null) or ("attempt_count" > 0 and "last_attempt_at" is not null)))
					or ("state" = 'processing' and "attempt_count" > 0 and "last_attempt_at" is not null and "processed_at" is null and "processed_bundle_id" is null and "last_error" is null and "lease_owner" is not null and "lease_expires_at" is not null)
					or ("state" = 'failed' and "attempt_count" > 0 and "last_attempt_at" is not null and "processed_at" is null and "processed_bundle_id" is null and "last_error" is not null and "lease_owner" is null and "lease_expires_at" is null)
					or ("state" = 'completed' and "attempt_count" > 0 and "last_attempt_at" is not null and "processed_at" is not null and "processed_bundle_id" is not null and "last_error" is null and "lease_owner" is null and "lease_expires_at" is null)
				)
			));--> statement-breakpoint
CREATE FUNCTION "content_bundle_immutable"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."state" IN ('ready', 'failed') THEN
			RAISE EXCEPTION 'terminal content_bundle is immutable' USING ERRCODE = '55000';
		END IF;
		RETURN OLD;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."version" IS DISTINCT FROM OLD."version"
		OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'immutable content_bundle identity cannot change' USING ERRCODE = '55000';
	END IF;

	IF OLD."state" IN ('ready', 'failed') THEN
		RAISE EXCEPTION 'terminal content_bundle is immutable' USING ERRCODE = '55000';
	END IF;

	IF NEW."state" IS DISTINCT FROM OLD."state"
		AND NOT (OLD."state" = 'building' AND NEW."state" IN ('ready', 'failed')) THEN
		RAISE EXCEPTION 'illegal content_bundle state transition' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_bundle_immutable_trigger"
	BEFORE UPDATE OR DELETE ON "content_bundle"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_immutable"();--> statement-breakpoint
CREATE FUNCTION "content_bundle_blob_immutable"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'immutable content_bundle_blob cannot be updated' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_bundle_blob_immutable_trigger"
	BEFORE UPDATE ON "content_bundle_blob"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_blob_immutable"();--> statement-breakpoint
CREATE FUNCTION "content_bundle_manifest_entry_immutable"() RETURNS trigger AS $$
DECLARE
	bundle_state text;
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		RAISE EXCEPTION 'immutable content_bundle_manifest_entry cannot be changed' USING ERRCODE = '55000';
	END IF;

	SELECT "state" INTO bundle_state FROM "content_bundle" WHERE "id" = NEW."bundle_id" FOR UPDATE;
	IF bundle_state IS DISTINCT FROM 'building' THEN
		RAISE EXCEPTION 'content_bundle_manifest_entry can be inserted only while its bundle is building' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_bundle_manifest_entry_immutable_trigger"
	BEFORE INSERT OR UPDATE OR DELETE ON "content_bundle_manifest_entry"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_manifest_entry_immutable"();--> statement-breakpoint
CREATE FUNCTION "content_bundle_channel_validate"() RETURNS trigger AS $$
DECLARE
	new_version bigint;
	old_version bigint;
	new_state text;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'immutable content_bundle_channel identity cannot be deleted' USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW."id" IS DISTINCT FROM OLD."id" THEN
		RAISE EXCEPTION 'immutable content_bundle_channel identity cannot change' USING ERRCODE = '55000';
	END IF;
	IF NEW."current_bundle_id" IS NULL THEN
		IF TG_OP = 'UPDATE' AND OLD."current_bundle_id" IS NOT NULL THEN
			RAISE EXCEPTION 'current bundle cannot be cleared' USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	SELECT "version", "state" INTO new_version, new_state
	FROM "content_bundle" WHERE "id" = NEW."current_bundle_id";
	IF new_state IS DISTINCT FROM 'ready' THEN
		RAISE EXCEPTION 'current bundle must be ready' USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'UPDATE' AND OLD."current_bundle_id" IS NOT NULL THEN
		SELECT "version" INTO old_version FROM "content_bundle" WHERE "id" = OLD."current_bundle_id";
		IF new_version <= old_version THEN
			RAISE EXCEPTION 'current bundle version must increase' USING ERRCODE = '55000';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_bundle_channel_validate_trigger"
	BEFORE INSERT OR UPDATE OF "id", "current_bundle_id" OR DELETE ON "content_bundle_channel"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_channel_validate"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "content_bundle_rebuild_request_immutable"() RETURNS trigger AS $$
DECLARE
	processed_bundle_state text;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'immutable rebuild request identity: DELETE is forbidden' USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'INSERT' THEN
		IF NEW."state" IS DISTINCT FROM 'pending' THEN
			RAISE EXCEPTION 'rebuild request must start pending' USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."item_id" IS DISTINCT FROM OLD."item_id"
		OR NEW."published_version_id" IS DISTINCT FROM OLD."published_version_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'immutable rebuild request identity cannot change' USING ERRCODE = '55000';
	END IF;

	IF OLD."state" = 'completed' THEN
		RAISE EXCEPTION 'terminal completed rebuild request is immutable' USING ERRCODE = '55000';
	END IF;

	IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
		(OLD."state" IN ('pending', 'failed') AND NEW."state" = 'processing')
		OR (OLD."state" = 'failed' AND NEW."state" = 'pending')
		OR (OLD."state" = 'processing' AND NEW."state" IN ('completed', 'failed', 'pending'))
	) THEN
		RAISE EXCEPTION 'illegal rebuild delivery state transition: % to %', OLD."state", NEW."state" USING ERRCODE = '55000';
	END IF;

	IF OLD."state" IN ('pending', 'failed') AND NEW."state" = 'processing' THEN
		IF NEW."attempt_count" <> OLD."attempt_count" + 1 THEN
			RAISE EXCEPTION 'processing must increment attempt_count exactly once' USING ERRCODE = '55000';
		END IF;
		IF OLD."available_at" > statement_timestamp() THEN
			RAISE EXCEPTION 'rebuild request is not due' USING ERRCODE = '55000';
		END IF;
		IF NEW."lease_expires_at" IS NULL OR NEW."lease_expires_at" <= statement_timestamp() THEN
			RAISE EXCEPTION 'lease expiry must be future at claim' USING ERRCODE = '55000';
		END IF;
	ELSIF NEW."attempt_count" <> OLD."attempt_count" THEN
		RAISE EXCEPTION 'attempt_count may change only when processing begins' USING ERRCODE = '55000';
	END IF;

	IF OLD."state" = 'processing' AND NEW."state" = 'pending' THEN
		IF OLD."lease_expires_at" IS NULL OR OLD."lease_expires_at" > statement_timestamp() THEN
			RAISE EXCEPTION 'cannot recover an unexpired rebuild lease' USING ERRCODE = '55000';
		END IF;
		IF NEW."lease_owner" IS NOT NULL OR NEW."lease_expires_at" IS NOT NULL
			OR NEW."processed_bundle_id" IS NOT NULL OR NEW."processed_at" IS NOT NULL
			OR NEW."available_at" > statement_timestamp()
			OR NEW."last_error" IS DISTINCT FROM 'lease_expired' THEN
			RAISE EXCEPTION 'expired lease recovery metadata is invalid' USING ERRCODE = '55000';
		END IF;
	END IF;

	IF OLD."state" = 'processing' AND NEW."state" IN ('processing', 'completed', 'failed')
		AND (OLD."lease_expires_at" IS NULL OR OLD."lease_expires_at" <= statement_timestamp()) THEN
		RAISE EXCEPTION 'expired rebuild lease belongs to recovery' USING ERRCODE = '55000';
	END IF;

	IF OLD."state" = 'failed' AND NEW."state" = 'pending'
		AND NEW."available_at" > statement_timestamp() THEN
		RAISE EXCEPTION 'pending retry must be due' USING ERRCODE = '55000';
	END IF;

	IF OLD."state" = 'processing' AND NEW."state" = 'completed' THEN
		SELECT "state" INTO processed_bundle_state
		FROM "content_bundle" WHERE "id" = NEW."processed_bundle_id";
		IF processed_bundle_state IS DISTINCT FROM 'ready' THEN
			RAISE EXCEPTION 'processed bundle must be ready' USING ERRCODE = '55000';
		END IF;
	END IF;

	IF OLD."state" = 'processing' AND NEW."state" = 'processing' THEN
		IF NEW."attempt_count" IS DISTINCT FROM OLD."attempt_count"
			OR NEW."last_attempt_at" IS DISTINCT FROM OLD."last_attempt_at"
			OR NEW."lease_owner" IS DISTINCT FROM OLD."lease_owner"
			OR NEW."lease_expires_at" < OLD."lease_expires_at"
			OR NEW."lease_expires_at" <= statement_timestamp() THEN
			RAISE EXCEPTION 'active rebuild lease may only be extended' USING ERRCODE = '55000';
		END IF;
	END IF;

	IF NEW."available_at" < OLD."available_at"
		OR (OLD."last_attempt_at" IS NOT NULL AND NEW."last_attempt_at" < OLD."last_attempt_at")
		OR (OLD."processed_at" IS NOT NULL AND NEW."processed_at" IS DISTINCT FROM OLD."processed_at") THEN
		RAISE EXCEPTION 'rebuild delivery timestamps cannot move backwards' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER "content_bundle_rebuild_request_immutable_trigger" ON "content_bundle_rebuild_request";--> statement-breakpoint
CREATE TRIGGER "content_bundle_rebuild_request_immutable_trigger"
	BEFORE INSERT OR UPDATE OR DELETE ON "content_bundle_rebuild_request"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_rebuild_request_immutable"();
