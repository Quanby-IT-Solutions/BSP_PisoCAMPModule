CREATE TABLE "asset_object" (
	"sha256" text PRIMARY KEY,
	"byte_length" integer NOT NULL,
	"media_type" text NOT NULL,
	"body" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_object_metadata_unique" UNIQUE("sha256","byte_length","media_type"),
	CONSTRAINT "asset_object_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_object_size_check" CHECK ("byte_length" between 1 and 52428800 and (
				("media_type" in ('image/png', 'image/jpeg', 'image/webp') and "byte_length" <= 10485760)
				or ("media_type" in ('audio/mpeg', 'audio/aac') and "byte_length" <= 26214400)
				or ("media_type" in ('model/gltf-binary', 'model/gltf+json', 'model/vnd.usdz+zip') and "byte_length" <= 52428800)
			)),
	CONSTRAINT "asset_object_media_type_check" CHECK ("media_type" in ('image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/aac', 'model/gltf-binary', 'model/gltf+json', 'model/vnd.usdz+zip')),
	CONSTRAINT "asset_object_body_length_check" CHECK (octet_length("body") = "byte_length")
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_item_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"media_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	CONSTRAINT "asset_content_item_id_id_unique" UNIQUE("content_item_id","id"),
	CONSTRAINT "asset_version_check" CHECK ("version" > 0),
	CONSTRAINT "asset_deletion_pair_check" CHECK (("deleted_at" is null) = ("deleted_by" is null))
);
--> statement-breakpoint
CREATE TABLE "version_asset" (
	"content_item_id" uuid NOT NULL,
	"content_version_id" uuid,
	"asset_id" uuid NOT NULL,
	"role" text,
	CONSTRAINT "version_asset_pkey" PRIMARY KEY("content_version_id","role"),
	CONSTRAINT "version_asset_role_check" CHECK ("role" in ('obverse', 'reverse', 'edge', 'texture', 'audio', 'animation'))
);
--> statement-breakpoint
CREATE INDEX "asset_content_item_created_idx" ON "asset" ("content_item_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "asset_sha256_idx" ON "asset" ("sha256");--> statement-breakpoint
CREATE INDEX "asset_active_content_item_created_idx" ON "asset" ("content_item_id","created_at" DESC NULLS LAST) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "version_asset_asset_idx" ON "version_asset" ("asset_id");--> statement-breakpoint
CREATE INDEX "version_asset_content_item_version_idx" ON "version_asset" ("content_item_id","content_version_id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_content_item_id_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_item"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_users_id_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_deleted_by_users_id_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_object_metadata_fkey" FOREIGN KEY ("sha256","byte_length","media_type") REFERENCES "asset_object"("sha256","byte_length","media_type") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "version_asset" ADD CONSTRAINT "version_asset_content_item_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "version_asset" ADD CONSTRAINT "version_asset_asset_item_fkey" FOREIGN KEY ("content_item_id","asset_id") REFERENCES "asset"("content_item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_asset_object_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'immutable asset_object rows cannot be updated or deleted';
END;
$$;--> statement-breakpoint
CREATE TRIGGER asset_object_immutable_trigger
BEFORE UPDATE OR DELETE ON asset_object
FOR EACH ROW EXECUTE FUNCTION prevent_asset_object_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_version_asset_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'immutable version_asset rows cannot be updated or deleted';
END;
$$;--> statement-breakpoint
CREATE TRIGGER version_asset_immutable_trigger
BEFORE UPDATE OR DELETE ON version_asset
FOR EACH ROW EXECUTE FUNCTION prevent_version_asset_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_asset_immutable_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'immutable asset metadata cannot be deleted';
	END IF;

	IF ROW(
		OLD.id,
		OLD.content_item_id,
		OLD.sha256,
		OLD.byte_length,
		OLD.media_type,
		OLD.version,
		OLD.uploaded_by,
		OLD.created_at
	) IS DISTINCT FROM ROW(
		NEW.id,
		NEW.content_item_id,
		NEW.sha256,
		NEW.byte_length,
		NEW.media_type,
		NEW.version,
		NEW.uploaded_by,
		NEW.created_at
	) THEN
		RAISE EXCEPTION 'immutable asset metadata cannot be changed';
	END IF;

	IF OLD.deleted_at IS NULL
		AND OLD.deleted_by IS NULL
		AND NEW.deleted_at IS NOT NULL
		AND NEW.deleted_by IS NOT NULL THEN
		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'immutable asset metadata permits only one tombstone transition';
END;
$$;--> statement-breakpoint
CREATE TRIGGER asset_immutable_trigger
BEFORE UPDATE OR DELETE ON asset
FOR EACH ROW EXECUTE FUNCTION enforce_asset_immutable_metadata();
