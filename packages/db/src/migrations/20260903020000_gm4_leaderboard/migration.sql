CREATE TABLE "leaderboard_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"period_type" text NOT NULL,
	"period_start" date NOT NULL,
	"account_id" text NOT NULL,
	"score" integer NOT NULL,
	"rank" integer NOT NULL,
	"rank_movement" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_entry_period_account_unique" UNIQUE("period_type","period_start","account_id"),
	CONSTRAINT "leaderboard_entry_period_type_check" CHECK ("period_type" in ('weekly', 'monthly', 'all_time')),
	CONSTRAINT "leaderboard_entry_score_check" CHECK ("score" >= 0),
	CONSTRAINT "leaderboard_entry_rank_check" CHECK ("rank" >= 1)
);
--> statement-breakpoint
ALTER TABLE "piso_camp_profile" ADD COLUMN "leaderboard_alias" text;--> statement-breakpoint
CREATE INDEX "leaderboard_entry_period_rank_idx" ON "leaderboard_entry" ("period_type","period_start","rank");--> statement-breakpoint
ALTER TABLE "leaderboard_entry" ADD CONSTRAINT "leaderboard_entry_account_id_users_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE CASCADE;