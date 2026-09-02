ALTER TABLE "content_version" ADD COLUMN "feature_level" text;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "hotspot_x_permille" integer;--> statement-breakpoint
ALTER TABLE "content_version" ADD COLUMN "hotspot_y_permille" integer;--> statement-breakpoint
-- Existing security features predate the field and are already published and
-- shown, so they keep being shown: 'first' preserves what devices see today.
-- Reclassifying one to 'second' is an editorial act, not a migration's to make.
UPDATE "content_version" SET "feature_level" = 'first' WHERE "content_type" = 'security_feature';--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_feature_level_check" CHECK (("content_type" = 'security_feature') = ("feature_level" is not null)
				and ("feature_level" is null or "feature_level" in ('first', 'second')));--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_hotspot_check" CHECK (("hotspot_x_permille" is null) = ("hotspot_y_permille" is null)
				and (
					"hotspot_x_permille" is null
					or (
						"feature_level" = 'first'
						and "hotspot_x_permille" between 0 and 1000
						and "hotspot_y_permille" between 0 and 1000
					)
				));