-- GM-1. A CHECK cannot contain a subquery, so "exactly one choice is correct"
-- and "every label is plain text" are immutable functions over the array.
CREATE OR REPLACE FUNCTION "pisocamp_trivia_correct_count"(choices jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
	SELECT count(*)::integer
	FROM jsonb_array_elements(choices) AS choice
	WHERE (choice ->> 'correct')::boolean IS TRUE
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pisocamp_trivia_labels_valid"(choices jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
	SELECT count(*) = jsonb_array_length(choices)
		AND count(DISTINCT choice ->> 'label') = jsonb_array_length(choices)
	FROM jsonb_array_elements(choices) AS choice
	WHERE jsonb_typeof(choice) = 'object'
		AND jsonb_typeof(choice -> 'correct') = 'boolean'
		AND jsonb_typeof(choice -> 'label') = 'string'
		AND btrim(choice ->> 'label') = choice ->> 'label'
		AND char_length(choice ->> 'label') BETWEEN 1 AND 200
		AND (choice ->> 'label') !~ '<!--|</?[A-Za-z]|<!|<\?'
$$;--> statement-breakpoint
CREATE TABLE "trivia_question_detail" (
	"content_version_id" uuid PRIMARY KEY,
	"content_item_id" uuid NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"choices" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "trivia_question_detail_category_check" CHECK ("category" = btrim("category") and char_length("category") between 1 and 64 and "category" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "trivia_question_detail_difficulty_check" CHECK ("difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "trivia_question_detail_choices_shape_check" CHECK (jsonb_typeof("choices") = 'array' and jsonb_array_length("choices") between 2 and 6),
	CONSTRAINT "trivia_question_detail_choices_correct_check" CHECK (pisocamp_trivia_correct_count("choices") = 1),
	CONSTRAINT "trivia_question_detail_choices_labels_check" CHECK (pisocamp_trivia_labels_valid("choices"))
);
--> statement-breakpoint
CREATE INDEX "trivia_question_detail_item_idx" ON "trivia_question_detail" ("content_item_id");--> statement-breakpoint
CREATE INDEX "trivia_question_detail_selection_idx" ON "trivia_question_detail" ("category","difficulty") WHERE "active";--> statement-breakpoint
ALTER TABLE "trivia_question_detail" ADD CONSTRAINT "trivia_question_detail_version_fkey" FOREIGN KEY ("content_item_id","content_version_id") REFERENCES "content_version"("item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_item" DROP CONSTRAINT "content_item_type_check", ADD CONSTRAINT "content_item_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_type_check", ADD CONSTRAINT "content_version_type_check" CHECK ("content_type" in ('banknote', 'coin', 'security_feature', 'advisory', 'link', 'trivia_question'));--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_fields_check", ADD CONSTRAINT "content_version_fields_check" CHECK ((
				("content_type" = 'banknote' and "series_code" in ('fpp-banknotes', 'engc-banknotes', 'ngc-banknotes') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'coin' and "series_code" in ('ngc-coins', 'bsp-coin-series') and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'security_feature' and "series_code" is not null and "denomination_code" is not null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'advisory' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
				or ("content_type" = 'link' and "series_code" is null and "denomination_code" is null and "primary_url" is not null)
				or ("content_type" = 'trivia_question' and "series_code" is null and "denomination_code" is null and "body" is not null and char_length("body") between 1 and 10000 and "primary_url" is null)
			));