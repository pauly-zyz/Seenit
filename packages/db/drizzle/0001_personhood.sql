CREATE TYPE "public"."verification_session_status" AS ENUM('pending', 'verified', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "verification_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "personhood_provider" NOT NULL,
	"status" "verification_session_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personhood_attestations" ADD COLUMN "verified_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "personhood_attestations" ADD COLUMN "result" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_sessions" ADD CONSTRAINT "verification_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_sessions_user_idx" ON "verification_sessions" USING btree ("user_id","provider","status");