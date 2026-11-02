CREATE TABLE "funder_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"funder_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funder_sessions" ADD CONSTRAINT "funder_sessions_funder_id_funders_id_fk" FOREIGN KEY ("funder_id") REFERENCES "public"."funders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funder_sessions_funder_idx" ON "funder_sessions" USING btree ("funder_id");