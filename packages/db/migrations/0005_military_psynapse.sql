CREATE TYPE "public"."agc_project_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "agc_project_members" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agc_project_members_project_id_agent_id_pk" PRIMARY KEY("project_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agc_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"brief" text,
	"status" "agc_project_status" DEFAULT 'active' NOT NULL,
	"task_counter" integer DEFAULT 0 NOT NULL,
	"task_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agc_projects_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "agc_project_members" ADD CONSTRAINT "agc_project_members_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."agc_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_project_members" ADD CONSTRAINT "agc_project_members_org_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_projects" ADD CONSTRAINT "agc_projects_organization_id_agc_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."agc_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agc_project_members_lead_key" ON "agc_project_members" USING btree ("project_id") WHERE role = 'lead';--> statement-breakpoint
CREATE INDEX "agc_project_members_agent_idx" ON "agc_project_members" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agc_projects_org_slug_key" ON "agc_projects" USING btree ("organization_id",lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "agc_projects_org_prefix_key" ON "agc_projects" USING btree ("organization_id",upper("task_prefix"));--> statement-breakpoint
CREATE INDEX "agc_projects_org_status_created_idx" ON "agc_projects" USING btree ("organization_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);