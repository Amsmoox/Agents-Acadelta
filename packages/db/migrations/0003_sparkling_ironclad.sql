CREATE TYPE "public"."agc_run_status" AS ENUM('leased', 'running', 'completed', 'failed', 'cancelled', 'orphaned');--> statement-breakpoint
CREATE TYPE "public"."agc_wakeup_status" AS ENUM('pending', 'claimed', 'skipped');--> statement-breakpoint
CREATE TABLE "agc_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"wakeup_id" uuid,
	"status" "agc_run_status" DEFAULT 'leased' NOT NULL,
	"leased_by" text NOT NULL,
	"pid" integer,
	"pid_started_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reap_count" integer DEFAULT 0 NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"prompt" text NOT NULL,
	"system_prompt" text,
	"transcript_path" text,
	"exit_code" integer,
	"stop_reason" text,
	"error" text,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agc_agent_wakeups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt" text,
	"status" "agc_wakeup_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agc_run_events" (
	"run_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "agc_run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
ALTER TABLE "agc_agents" ADD COLUMN "spent_monthly_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agc_agent_runs" ADD CONSTRAINT "agc_agent_runs_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_agent_wakeups" ADD CONSTRAINT "agc_agent_wakeups_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_run_events" ADD CONSTRAINT "agc_run_events_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agc_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agc_agent_runs_active_key" ON "agc_agent_runs" USING btree ("agent_id") WHERE status in ('leased', 'running');--> statement-breakpoint
CREATE INDEX "agc_agent_runs_agent_created_idx" ON "agc_agent_runs" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agc_agent_runs_live_idx" ON "agc_agent_runs" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agc_agent_wakeups_pending_key" ON "agc_agent_wakeups" USING btree ("agent_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "agc_agent_wakeups_ready_idx" ON "agc_agent_wakeups" USING btree ("status","updated_at");