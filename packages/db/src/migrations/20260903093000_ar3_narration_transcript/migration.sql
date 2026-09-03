-- AR-3: the narration transcript is the caption and the text alternative, so it
-- is required. Added in three steps rather than one, because an AR experience
-- may already exist: a NOT NULL column added to a populated table fails, and a
-- migration that only works on an empty database is not a migration.
ALTER TABLE "ar_experience_detail" ADD COLUMN "narration_transcript" text;--> statement-breakpoint
-- Marked rather than invented. An experience carrying this has no approved
-- narration text yet, and the words say so wherever they are displayed.
UPDATE "ar_experience_detail"
	SET "narration_transcript" = '[Narration transcript not yet supplied.]'
	WHERE "narration_transcript" IS NULL;--> statement-breakpoint
ALTER TABLE "ar_experience_detail" ALTER COLUMN "narration_transcript" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_experience_detail" ADD CONSTRAINT "ar_experience_detail_narration_check" CHECK (char_length("narration_transcript") between 1 and 4000);
