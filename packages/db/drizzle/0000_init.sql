CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('pending_funding', 'active', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."personhood_provider" AS ENUM('human_passport', 'self');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('awaiting_upload', 'rejected_precheck', 'chain_failed', 'processing', 'ready', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"name" text DEFAULT 'default' NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personhood_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "personhood_provider" NOT NULL,
	"tier" smallint NOT NULL,
	"nullifier_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"tier" smallint DEFAULT 0 NOT NULL,
	"reputation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funder_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"media_type" "media_type" NOT NULL,
	"max_video_seconds" integer,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_meters" integer NOT NULL,
	"reward" numeric(78, 0) NOT NULL,
	"max_captures" integer NOT NULL,
	"min_tier" smallint NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" "mission_status" DEFAULT 'pending_funding' NOT NULL,
	"output_schema" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"onchain_id" bigint,
	"chain_tx_hash" text,
	"funder_wallet" text,
	"fee_bps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"finalized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"media_key" text NOT NULL,
	"blurred_media_key" text,
	"media_hash" text,
	"media_type" "media_type" NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"gps_accuracy_meters" real,
	"captured_at" timestamp with time zone,
	"device_info" jsonb,
	"status" "submission_status" DEFAULT 'awaiting_upload' NOT NULL,
	"rejection_reasons" jsonb,
	"ai_result" jsonb,
	"ai_confidence" real,
	"onchain_id" bigint,
	"record_tx_hash" text,
	"resolve_tx_hash" text,
	"review_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_events" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"event_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_events_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personhood_attestations" ADD CONSTRAINT "personhood_attestations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_contributor_id_users_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contributor_id_users_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("funder_id") WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "funders_wallet_idx" ON "funders" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "personhood_nullifier_key" ON "personhood_attestations" USING btree ("nullifier_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "personhood_user_provider_key" ON "personhood_attestations" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_key" ON "users" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "missions_spec_hash_key" ON "missions" USING btree ("spec_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "missions_onchain_id_key" ON "missions" USING btree ("onchain_id");--> statement-breakpoint
CREATE INDEX "missions_status_deadline_idx" ON "missions" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "missions_geo_idx" ON "missions" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "missions_funder_idx" ON "missions" USING btree ("funder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_submission_key" ON "payouts" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_media_hash_key" ON "submissions" USING btree ("media_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_onchain_id_key" ON "submissions" USING btree ("onchain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_mission_contributor_key" ON "submissions" USING btree ("mission_id","contributor_id");--> statement-breakpoint
CREATE INDEX "submissions_mission_status_idx" ON "submissions" USING btree ("mission_id","status");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_after");