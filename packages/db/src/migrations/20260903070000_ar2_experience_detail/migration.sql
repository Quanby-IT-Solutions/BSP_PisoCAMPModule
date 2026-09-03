CREATE TABLE "ar_experience_detail" (
	"content_version_id" uuid PRIMARY KEY,
	"content_item_id" uuid NOT NULL,
	"series_code" text NOT NULL,
	"denomination_code" text NOT NULL,
	"minimum_android_sdk" integer,
	"minimum_ios_version" text,
	"animation_duration_ms" integer NOT NULL,
	CONSTRAINT "ar_experience_detail_device_check" CHECK ("minimum_android_sdk" is not null or "minimum_ios_version" is not null),
	CONSTRAINT "ar_experience_detail_android_check" CHECK ("minimum_android_sdk" is null or "minimum_android_sdk" between 24 and 40),
	CONSTRAINT "ar_experience_detail_ios_check" CHECK ("minimum_ios_version" is null or "minimum_ios_version" ~ '^[0-9]{1,2}([.][0-9]{1,2}){0,2}$'),
	CONSTRAINT "ar_experience_detail_duration_check" CHECK ("animation_duration_ms" between 1000 and 300000)
);
--> statement-breakpoint
CREATE INDEX "ar_experience_detail_item_idx" ON "ar_experience_detail" ("content_item_id");--> statement-breakpoint
CREATE INDEX "ar_experience_detail_denomination_idx" ON "ar_experience_detail" ("series_code","denomination_code");--> statement-breakpoint
ALTER TABLE "ar_experience_detail" ADD CONSTRAINT "ar_experience_detail_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ar_experience_detail" ADD CONSTRAINT "ar_experience_detail_denomination_fkey" FOREIGN KEY ("denomination_code","series_code") REFERENCES "piso_camp_currency_denomination"("code","series_code") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_item" DROP CONSTRAINT "content_item_type_check", ADD CONSTRAINT "content_item_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question', 'survey', 'ar_experience'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_type_check", ADD CONSTRAINT "content_version_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question', 'survey', 'ar_experience'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_fields_check", ADD CONSTRAINT "content_version_fields_check" CHECK ((
				("content_type" = 'banknote' and "series_code" in ('fpp-banknotes', 'engc-banknotes', 'ngc-banknotes') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'coin' and "series_code" in ('ngc-coins', 'bsp-coin-series') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'security_feature' and "series_code" is not null and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'advisory' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'link' and "series_code" is null and "denomination_code" is null and "primary_url" is not null)
				or ("content_type" = 'trivia_question' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'survey' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'ar_experience' and "series_code" is not null and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
			));--> statement-breakpoint
ALTER TABLE "version_asset" DROP CONSTRAINT "version_asset_role_check", ADD CONSTRAINT "version_asset_role_check" CHECK ("role" in ('obverse', 'reverse', 'edge', 'texture', 'audio', 'animation', 'ar_model'));