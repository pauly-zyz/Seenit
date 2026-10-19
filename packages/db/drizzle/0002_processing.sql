ALTER TYPE "public"."submission_status" ADD VALUE 'needs_review' BEFORE 'accepted';--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "funders" ADD COLUMN "webhook_secret_enc" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "blurred_frame_keys" jsonb;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "original_archive_key" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "original_purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "original_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processed_at" timestamp with time zone;