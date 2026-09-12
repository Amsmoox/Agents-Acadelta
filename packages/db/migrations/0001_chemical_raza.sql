CREATE TYPE "public"."agc_agent_status" AS ENUM('pending_approval', 'idle', 'running', 'paused', 'error', 'terminated');--> statement-breakpoint
CREATE TABLE "agc_agents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"role" text DEFAULT 'general' NOT NULL,
	"title" text,
	"icon" text,
	"capabilities" text,
	"reports_to" uuid,
	"adapter_type" text NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agc_agent_status" DEFAULT 'idle' NOT NULL,
	"pause_reason" text,
	"paused_at" timestamp with time zone,
	"error_reason" text,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_monthly_cents" integer DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agc_agents_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "agc_agent_config_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text DEFAULT 'patch' NOT NULL,
	"rolled_back_from_revision_id" uuid,
	"changed_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"before_config" jsonb NOT NULL,
	"after_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agc_agents" ADD CONSTRAINT "agc_agents_organization_id_agc_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."agc_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_agents" ADD CONSTRAINT "agc_agents_reports_to_agc_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agc_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_agent_config_revisions" ADD CONSTRAINT "agc_agent_config_revisions_organization_id_agc_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."agc_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_agent_config_revisions" ADD CONSTRAINT "agc_agent_config_revisions_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agc_agents_org_slug_key" ON "agc_agents" USING btree ("organization_id",lower("slug"));--> statement-breakpoint
CREATE INDEX "agc_agents_org_status_idx" ON "agc_agents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agc_agents_org_reports_to_idx" ON "agc_agents" USING btree ("organization_id","reports_to");--> statement-breakpoint
CREATE INDEX "agc_agents_org_created_idx" ON "agc_agents" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agc_agent_config_revisions_agent_created_idx" ON "agc_agent_config_revisions" USING btree ("agent_id","created_at" DESC NULLS LAST);