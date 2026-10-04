ALTER TABLE "feed_states" ADD COLUMN "ai_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "learned_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "next_poll_at";