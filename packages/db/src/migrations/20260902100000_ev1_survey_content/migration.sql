CREATE TABLE "survey_detail" (
	"content_version_id" uuid PRIMARY KEY,
	"content_item_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"subject_content_item_id" uuid,
	CONSTRAINT "survey_detail_purpose_check" CHECK ("purpose" in ('topic', 'satisfaction', 'feature', 'application', 'nps', 'usefulness')),
	CONSTRAINT "survey_detail_subject_check" CHECK ("subject_content_item_id" <> "content_item_id")
);
--> statement-breakpoint
CREATE TABLE "survey_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_version_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"required" boolean NOT NULL,
	"scale_min" integer,
	"scale_max" integer,
	"low_label" text,
	"high_label" text,
	"nps_promoter_min" integer,
	"nps_passive_min" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_question_version_position_unique" UNIQUE("content_version_id","position"),
	CONSTRAINT "survey_question_position_check" CHECK ("position" between 0 and 19),
	CONSTRAINT "survey_question_kind_check" CHECK ("kind" in ('rating', 'nps', 'text')),
	CONSTRAINT "survey_question_prompt_check" CHECK ("prompt" = btrim("prompt") and char_length("prompt") between 1 and 300 and "prompt" !~ '<!--|</?[A-Za-z]|<!|<\?'),
	CONSTRAINT "survey_question_shape_check" CHECK ((
				("kind" = 'rating' and "scale_min" = 1 and "scale_max" = 5
					and "low_label" is not null and "high_label" is not null
					and "nps_promoter_min" is null and "nps_passive_min" is null)
				or ("kind" = 'nps' and "scale_min" = 0 and "scale_max" = 10
					and "low_label" is not null and "high_label" is not null
					and "nps_promoter_min" = 9 and "nps_passive_min" = 7)
				or ("kind" = 'text' and "scale_min" is null and "scale_max" is null
					and "low_label" is null and "high_label" is null
					and "nps_promoter_min" is null and "nps_passive_min" is null)
			)),
	CONSTRAINT "survey_question_label_check" CHECK (("low_label" is null or ("low_label" = btrim("low_label") and char_length("low_label") between 1 and 100))
				and ("high_label" is null or ("high_label" = btrim("high_label") and char_length("high_label") between 1 and 100)))
);
--> statement-breakpoint
CREATE INDEX "survey_detail_item_idx" ON "survey_detail" ("content_item_id");--> statement-breakpoint
CREATE INDEX "survey_detail_subject_idx" ON "survey_detail" ("subject_content_item_id");--> statement-breakpoint
CREATE INDEX "survey_question_version_idx" ON "survey_question" ("content_version_id","position");--> statement-breakpoint
ALTER TABLE "survey_detail" ADD CONSTRAINT "survey_detail_subject_content_item_id_content_item_id_fkey" FOREIGN KEY ("subject_content_item_id") REFERENCES "content_item"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "survey_detail" ADD CONSTRAINT "survey_detail_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "survey_question" ADD CONSTRAINT "survey_question_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE CASCADE;
--> statement-breakpoint
-- EV-1 widens the content type. Drizzle does not diff CHECK changes, so the
-- three constraints that enumerate the types are replaced by hand.
ALTER TABLE "content_item" DROP CONSTRAINT "content_item_type_check";--> statement-breakpoint
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question', 'survey'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_type_check";--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question', 'survey'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_fields_check";--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_fields_check" CHECK ((
				("content_type" = 'banknote' and "series_code" in ('fpp-banknotes', 'engc-banknotes', 'ngc-banknotes') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'coin' and "series_code" in ('ngc-coins', 'bsp-coin-series') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'security_feature' and "series_code" is not null and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'advisory' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'link' and "series_code" is null and "denomination_code" is null and "primary_url" is not null)
				or ("content_type" = 'trivia_question' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'survey' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
			));
