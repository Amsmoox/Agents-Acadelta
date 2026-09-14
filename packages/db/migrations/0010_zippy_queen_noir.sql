ALTER TABLE "agc_objectives" ADD COLUMN "checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agc_objectives" ADD COLUMN "check_results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agc_objectives" ADD COLUMN "working_directory" text;--> statement-breakpoint
ALTER TABLE "agc_objectives" ADD COLUMN "satisfaction_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agc_objectives" ADD COLUMN "satisfaction_summary" text;