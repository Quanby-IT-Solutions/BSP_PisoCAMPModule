CREATE TABLE "trivia_response" (
	"response_id" uuid PRIMARY KEY,
	"account_id" text NOT NULL,
	"content_item_id" uuid NOT NULL,
	"content_version_id" uuid NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"correct" boolean NOT NULL,
	"skipped" boolean NOT NULL,
	"link_opened" boolean NOT NULL,
	"points" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trivia_response_category_check" CHECK ("category" = btrim("category") and char_length("category") between 1 and 64 and "category" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "trivia_response_difficulty_check" CHECK ("difficulty" in ('easy', 'medium', 'hard')),
	CONSTRAINT "trivia_response_outcome_check" CHECK (("skipped" is false or ("correct" is false and "points" = 0 and "link_opened" is false))
				and ("correct" is false or "link_opened" is false)),
	CONSTRAINT "trivia_response_points_check" CHECK ("points" between 0 and 100),
	CONSTRAINT "trivia_response_correct_points_check" CHECK (("correct" is false) = ("points" = 0))
);
--> statement-breakpoint
CREATE INDEX "trivia_response_account_idx" ON "trivia_response" ("account_id","answered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trivia_response_item_idx" ON "trivia_response" ("content_item_id");--> statement-breakpoint
ALTER TABLE "trivia_response" ADD CONSTRAINT "trivia_response_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE CASCADE;