ALTER TABLE "content_item" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_item" ADD COLUMN "publish_at_by" text;--> statement-breakpoint
CREATE INDEX "content_item_publish_at_idx" ON "content_item" ("publish_at") WHERE "publish_at" is not null;--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_publish_at_by_users_id_fkey" FOREIGN KEY ("publish_at_by") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_publish_at_check" CHECK (("publish_at" is null) = ("publish_at_by" is null) and ("publish_at" is null or "status" = 'approved'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_transition_action_check", ADD CONSTRAINT "content_version_transition_action_check" CHECK ("transition_action" is null or "transition_action" in ('submit', 'approve', 'reject', 'publish', 'unpublish', 'deactivate', 'archive'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_transition_lifecycle_check", ADD CONSTRAINT "content_version_transition_lifecycle_check" CHECK ((
				("transition_action" is null and "transition_comments" is null and "status" = 'draft')
				or ("transition_action" is not null and (
					("transition_action" = 'submit' and "status" = 'submitted_for_review')
					or ("transition_action" = 'approve' and "status" = 'approved' and "transition_comments" is not null)
					or ("transition_action" = 'reject' and "status" = 'draft' and "transition_comments" is not null)
					or ("transition_action" = 'publish' and "status" = 'published')
					or ("transition_action" = 'unpublish' and "status" = 'unpublished')
					or ("transition_action" = 'deactivate' and "status" = 'deactivated')
					or ("transition_action" = 'archive' and "status" = 'archived')
				))
			));--> statement-breakpoint
-- CM-6: a rebuild is due for every transition that changes what the bundle
-- contains, not only for publication. The request is keyed on the version the
-- transition created, which keeps the table's one-request-per-version rule.
CREATE OR REPLACE FUNCTION "content_bundle_rebuild_request_validate_published_version"() RETURNS trigger AS $$
BEGIN
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
