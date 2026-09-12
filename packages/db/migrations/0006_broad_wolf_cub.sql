CREATE TYPE "public"."agc_comment_author_type" AS ENUM('agent', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."agc_objective_status" AS ENUM('active', 'satisfied', 'exhausted', 'paused', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."agc_task_kind" AS ENUM('standard', 'investigate', 'review', 'report');--> statement-breakpoint
CREATE TYPE "public"."agc_task_priority" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."agc_task_status" AS ENUM('backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "agc_objectives" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"directive" text NOT NULL,
	"owner_agent_id" uuid NOT NULL,
	"exit_criteria" text NOT NULL,
	"status" "agc_objective_status" DEFAULT 'active' NOT NULL,
	"max_cycles" integer DEFAULT 10 NOT NULL,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"max_idle_cycles" integer DEFAULT 2 NOT NULL,
	"idle_cycles" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"report_task_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "agc_objectives_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "agc_run_credentials" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"responsible_user_id" text NOT NULL,
	"cross_task_write_limit" integer DEFAULT 20 NOT NULL,
	"cross_task_write_count" integer DEFAULT 0 NOT NULL,
	"current_task_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agc_task_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_type" "agc_comment_author_type" NOT NULL,
	"author_agent_id" uuid,
	"author_run_id" uuid,
	"author_user_id" text,
	"body" text NOT NULL,
	"intent" text DEFAULT 'note' NOT NULL,
	"trust" text DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agc_task_relations" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"related_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agc_task_relations_task_id_related_task_id_pk" PRIMARY KEY("task_id","related_task_id")
);
--> statement-breakpoint
CREATE TABLE "agc_task_review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"outcome" text NOT NULL,
	"body" text NOT NULL,
	"actor_agent_id" uuid,
	"actor_user_id" text,
	"actor_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agc_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"kind" "agc_task_kind" DEFAULT 'standard' NOT NULL,
	"priority" "agc_task_priority" DEFAULT 'normal' NOT NULL,
	"status" "agc_task_status" DEFAULT 'backlog' NOT NULL,
	"status_version" bigint DEFAULT 0 NOT NULL,
	"blocked_transition_at" timestamp with time zone,
	"assignee_agent_id" uuid,
	"responsible_user_id" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_run_id" uuid,
	"objective_id" uuid,
	"claimed_by_run_id" uuid,
	"claimed_at" timestamp with time zone,
	"review_policy" text DEFAULT 'not_creator' NOT NULL,
	"review_state_json" jsonb,
	"no_progress_runs" integer DEFAULT 0 NOT NULL,
	"last_run_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agc_tasks_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "agc_objectives" ADD CONSTRAINT "agc_objectives_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."agc_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_objectives" ADD CONSTRAINT "agc_objectives_org_owner_fk" FOREIGN KEY ("organization_id","owner_agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_run_credentials" ADD CONSTRAINT "agc_run_credentials_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agc_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_task_comments" ADD CONSTRAINT "agc_task_comments_org_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."agc_tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_task_relations" ADD CONSTRAINT "agc_task_relations_org_blocker_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."agc_tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_task_relations" ADD CONSTRAINT "agc_task_relations_org_dependent_fk" FOREIGN KEY ("organization_id","related_task_id") REFERENCES "public"."agc_tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_task_review_decisions" ADD CONSTRAINT "agc_task_review_decisions_org_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."agc_tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_tasks" ADD CONSTRAINT "agc_tasks_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."agc_projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_tasks" ADD CONSTRAINT "agc_tasks_org_parent_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "public"."agc_tasks"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agc_tasks" ADD CONSTRAINT "agc_tasks_org_assignee_fk" FOREIGN KEY ("organization_id","assignee_agent_id") REFERENCES "public"."agc_agents"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agc_objectives_active_owner_key" ON "agc_objectives" USING btree ("project_id","owner_agent_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "agc_run_credentials_hash_key" ON "agc_run_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agc_task_comments_task_idx" ON "agc_task_comments" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "agc_task_comments_org_recent_idx" ON "agc_task_comments" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agc_task_relations_dependent_idx" ON "agc_task_relations" USING btree ("related_task_id");--> statement-breakpoint
CREATE INDEX "agc_task_review_decisions_task_idx" ON "agc_task_review_decisions" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agc_tasks_project_number_key" ON "agc_tasks" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "agc_tasks_org_key_key" ON "agc_tasks" USING btree ("organization_id",upper("key"));--> statement-breakpoint
CREATE INDEX "agc_tasks_board_idx" ON "agc_tasks" USING btree ("project_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agc_tasks_parent_idx" ON "agc_tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "agc_tasks_objective_idx" ON "agc_tasks" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "agc_tasks_assignee_open_idx" ON "agc_tasks" USING btree ("assignee_agent_id","priority","created_at") WHERE status not in ('done', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "agc_tasks_open_dup_key" ON "agc_tasks" USING btree ("project_id","parent_id",lower(regexp_replace("title", 's+', ' ', 'g'))) WHERE status not in ('done', 'cancelled');