CREATE TABLE "content_bundle_rebuild_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"published_version_id" uuid NOT NULL CONSTRAINT "content_bundle_rebuild_request_published_version_unique" UNIQUE,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_bundle_rebuild_request_state_check" CHECK ("state" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "content_bundle_rebuild_request_attempt_count_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "content_bundle_rebuild_request_last_error_check" CHECK ("last_error" is null or ("attempt_count" > 0 and "last_error" = btrim("last_error") and char_length("last_error") between 1 and 1000 and "last_error" !~ '<!--|</?[A-Za-z]|<!|<\?')),
	CONSTRAINT "content_bundle_rebuild_request_delivery_metadata_check" CHECK ((
				("last_attempt_at" is null or "last_attempt_at" >= "created_at")
				and ("processed_at" is null or ("last_attempt_at" is not null and "processed_at" >= "last_attempt_at"))
				and (
					("state" = 'pending' and "processed_at" is null and (("attempt_count" = 0 and "last_attempt_at" is null) or ("attempt_count" > 0 and "last_attempt_at" is not null)))
					or ("state" = 'processing' and "attempt_count" > 0 and "last_attempt_at" is not null and "processed_at" is null and "last_error" is null)
					or ("state" = 'failed' and "attempt_count" > 0 and "last_attempt_at" is not null and "processed_at" is null and "last_error" is not null)
					or ("state" = 'completed' and "attempt_count" > 0 and "last_attempt_at" is not null and "processed_at" is not null and "last_error" is null)
				)
			))
);
--> statement-breakpoint
ALTER TABLE "content_item" ADD COLUMN "bundle_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "transition_action" text;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "transition_comments" text;--> statement-breakpoint
CREATE INDEX "content_bundle_rebuild_request_poll_idx" ON "content_bundle_rebuild_request" ("state","available_at","created_at");--> statement-breakpoint
CREATE INDEX "content_bundle_rebuild_request_item_created_idx" ON "content_bundle_rebuild_request" ("item_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "content_bundle_rebuild_request" ADD CONSTRAINT "content_bundle_rebuild_request_item_version_fkey" FOREIGN KEY ("item_id","published_version_id") REFERENCES "content_version"("item_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_request_fingerprint_check" CHECK ("request_fingerprint" is null or "request_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_transition_action_check" CHECK ("transition_action" is null or "transition_action" in ('submit', 'approve', 'reject', 'publish'));--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_transition_comments_check" CHECK ("transition_comments" is null or ("transition_comments" = btrim("transition_comments") and char_length("transition_comments") between 1 and 2000 and "transition_comments" !~ '<!--|</?[A-Za-z]|<!|<\?'));--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_transition_lifecycle_check" CHECK ((
				("transition_action" is null and "transition_comments" is null and "status" = 'draft')
				or ("transition_action" is not null and (
					("transition_action" = 'submit' and "status" = 'submitted_for_review')
					or ("transition_action" = 'approve' and "status" = 'approved' and "transition_comments" is not null)
					or ("transition_action" = 'reject' and "status" = 'draft' and "transition_comments" is not null)
					or ("transition_action" = 'publish' and "status" = 'published')
				))
			));--> statement-breakpoint
CREATE FUNCTION "content_bundle_rebuild_request_validate_published_version"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "content_version"
		WHERE "id" = NEW."published_version_id"
			AND "item_id" = NEW."item_id"
			AND "status" = 'published'
			AND "transition_action" = 'publish'
	) THEN
		RAISE EXCEPTION 'only a published transition version can be enqueued' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_bundle_rebuild_request_published_version_trigger"
	AFTER INSERT OR UPDATE OF "item_id", "published_version_id" ON "content_bundle_rebuild_request"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_rebuild_request_validate_published_version"();--> statement-breakpoint
CREATE FUNCTION "content_bundle_rebuild_request_immutable"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'immutable rebuild request identity: DELETE is forbidden' USING ERRCODE = '55000';
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."item_id" IS DISTINCT FROM OLD."item_id"
		OR NEW."published_version_id" IS DISTINCT FROM OLD."published_version_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'immutable rebuild request identity cannot change' USING ERRCODE = '55000';
	END IF;

	IF OLD."state" = 'completed' AND (
		NEW."state" IS DISTINCT FROM OLD."state"
		OR NEW."attempt_count" IS DISTINCT FROM OLD."attempt_count"
		OR NEW."available_at" IS DISTINCT FROM OLD."available_at"
		OR NEW."last_attempt_at" IS DISTINCT FROM OLD."last_attempt_at"
		OR NEW."processed_at" IS DISTINCT FROM OLD."processed_at"
		OR NEW."last_error" IS DISTINCT FROM OLD."last_error"
	) THEN
		RAISE EXCEPTION 'terminal completed rebuild request is immutable' USING ERRCODE = '55000';
	END IF;

	IF NEW."attempt_count" < OLD."attempt_count" THEN
		RAISE EXCEPTION 'attempt_count cannot decrease' USING ERRCODE = '55000';
	END IF;

	IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
		(OLD."state" = 'pending' AND NEW."state" = 'processing')
		OR (OLD."state" = 'processing' AND NEW."state" IN ('failed', 'completed'))
		OR (OLD."state" = 'failed' AND NEW."state" = 'pending')
	) THEN
		RAISE EXCEPTION 'illegal rebuild delivery state transition: % to %', OLD."state", NEW."state" USING ERRCODE = '55000';
	END IF;

	IF OLD."state" = 'pending' AND NEW."state" = 'processing' THEN
		IF NEW."attempt_count" <> OLD."attempt_count" + 1 THEN
			RAISE EXCEPTION 'processing must increment attempt_count exactly once' USING ERRCODE = '55000';
		END IF;
	ELSIF NEW."attempt_count" <> OLD."attempt_count" THEN
		RAISE EXCEPTION 'attempt_count may change only when processing begins' USING ERRCODE = '55000';
	END IF;

	IF NEW."available_at" < OLD."available_at"
		OR (OLD."last_attempt_at" IS NOT NULL AND NEW."last_attempt_at" < OLD."last_attempt_at")
		OR (OLD."processed_at" IS NOT NULL AND NEW."processed_at" IS DISTINCT FROM OLD."processed_at") THEN
		RAISE EXCEPTION 'rebuild delivery timestamps cannot move backwards' USING ERRCODE = '55000';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "content_bundle_rebuild_request_immutable_trigger"
	BEFORE UPDATE OR DELETE ON "content_bundle_rebuild_request"
	FOR EACH ROW EXECUTE FUNCTION "content_bundle_rebuild_request_immutable"();
